/**
 * GET  /api/booking/manage/[token] — Retrieve appointment details
 * POST /api/booking/manage/[token]/cancel is in the adjacent cancel route
 */

import { NextRequest, NextResponse } from "next/server";
import { hashManageToken } from "@/lib/booking-token";
import { getAppointmentByToken, getBookingSettingsByOrgId } from "@/lib/booking-store";
import { resolveEffectiveModality } from "@/lib/appointment-modality";
import { query } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const tokenHash = hashManageToken(token);
  const appointment = await getAppointmentByToken(tokenHash);

  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  // The expiry was stored from the start but never enforced, so a manage link kept working
  // indefinitely. Now that this response can also carry a video join link, an unbounded token is
  // a way into a consultation, so the stored expiry finally has to mean something. Same 404 as
  // an unknown token — an expired link shouldn't be distinguishable from a wrong one.
  if (new Date(appointment.manageTokenExpiresAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  const settings = await getBookingSettingsByOrgId(appointment.organizationId);

  // Since migration 067 the appointment carries its own modality; the clinic setting is only the
  // fallback for rows booked before that (or where the clinic doesn't let patients choose).
  const modality = resolveEffectiveModality(
    appointment.appointmentModality,
    settings?.appointmentModality,
  );

  // Doxy has one permanent waiting room per provider, so this is a lookup rather than anything
  // minted per visit — and it is the same link the confirmation email carried.
  const doxyRoomUrl =
    modality === "VIDEO" ? await resolveDoxyRoom(appointment.physicianId) : null;

  // Don't expose health card number via manage link
  return NextResponse.json({
    appointment: {
      ...appointment,
      healthCardNumber: undefined,
      // The phone is on the row now, but there is no reason for the manage page to echo it back.
      patientPhone: undefined,
      appointmentModality: modality,
      doxyRoomUrl,
    },
  });
}

/** The provider's permanent Doxy waiting room, or null when they haven't set one. */
async function resolveDoxyRoom(physicianId: string): Promise<string | null> {
  const res = await query<{ doxy_room_url: string | null }>(
    `SELECT doxy_room_url FROM physicians WHERE id = $1`,
    [physicianId],
  );
  return res.rows[0]?.doxy_room_url ?? null;
}
