/**
 * GET /api/org/appointments
 * Lists all appointments for the logged-in org.
 *
 * Query params (all optional):
 *   physicianId, dateFrom (YYYY-MM-DD), dateTo (YYYY-MM-DD)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getAppointmentsForOrg, getBookingSettingsByOrgId } from "@/lib/booking-store";
import { resolveEffectiveModality } from "@/lib/appointment-modality";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/appointments", requestId, status, Date.now() - started);
      return res;
    }

    const sp = request.nextUrl.searchParams;
    const appointments = await getAppointmentsForOrg(session.organizationId, {
      physicianId: sp.get("physicianId") ?? undefined,
      dateFrom: sp.get("dateFrom") ?? undefined,
      dateTo: sp.get("dateTo") ?? undefined,
    });

    // appointments.appointment_modality is NULL whenever the booking inherits the clinic
    // default — which is every row made before migration 067, and every booking at a clinic
    // that doesn't let patients choose. Resolving it here means the table can simply print the
    // format instead of each caller having to know the inheritance rule (and getting it wrong
    // by showing nothing).
    const settings = await getBookingSettingsByOrgId(session.organizationId);

    // The provider's permanent Doxy waiting room, when the clinic uses one. Looked up per
    // provider rather than per appointment because that is what it is — one room, not one
    // per visit.
    const doxyRows = await query<{ id: string; doxy_room_url: string | null }>(
      `SELECT id, doxy_room_url FROM physicians WHERE organization_id = $1`,
      [session.organizationId],
    );
    const doxyByPhysician = new Map(doxyRows.rows.map((r) => [r.id, r.doxy_room_url]));

    const withModality = appointments.map((a) => ({
      ...a,
      appointmentModality: resolveEffectiveModality(
        a.appointmentModality,
        settings?.appointmentModality,
      ),
      doxyRoomUrl: doxyByPhysician.get(a.physicianId) ?? null,
    }));

    const res = NextResponse.json({ appointments: withModality });
    logRequestMeta("/api/org/appointments", requestId, status, Date.now() - started);
    return res;
  } catch {
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/appointments", requestId, status, Date.now() - started);
    return res;
  }
}
