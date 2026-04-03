/**
 * GET /api/org/appointments
 * Lists all appointments for the logged-in org.
 *
 * Query params (all optional):
 *   physicianId, dateFrom (YYYY-MM-DD), dateTo (YYYY-MM-DD)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getAppointmentsForOrg } from "@/lib/booking-store";
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

    const res = NextResponse.json({ appointments });
    logRequestMeta("/api/org/appointments", requestId, status, Date.now() - started);
    return res;
  } catch {
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/appointments", requestId, status, Date.now() - started);
    return res;
  }
}
