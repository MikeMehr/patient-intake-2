/**
 * GET  /api/booking/manage/[token] — Retrieve appointment details
 * POST /api/booking/manage/[token]/cancel is in the adjacent cancel route
 */

import { NextRequest, NextResponse } from "next/server";
import { hashManageToken } from "@/lib/booking-token";
import { getAppointmentByToken, getBookingSettingsByOrgId } from "@/lib/booking-store";
import { resolveEffectiveModality } from "@/lib/appointment-modality";
import { resolveAppUrl } from "@/lib/app-url";
import { query } from "@/lib/db";
import { decryptString } from "@/lib/encrypted-field";
import { resolveJoinState } from "@/lib/video/join-window";

export async function GET(
  req: NextRequest,
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

  const videoJoinUrl =
    modality === "VIDEO" ? await resolveVideoJoinUrl(appointment.id, resolveAppUrl(req)) : null;

  // Don't expose health card number via manage link
  return NextResponse.json({
    appointment: {
      ...appointment,
      healthCardNumber: undefined,
      // The phone is on the row now, but there is no reason for the manage page to echo it back.
      patientPhone: undefined,
      appointmentModality: modality,
      videoJoinUrl,
    },
  });
}

/**
 * The patient's own join link, for the page they already have a link to.
 *
 * Returned regardless of whether the window is open — the page shows a countdown and the join
 * endpoint is what actually refuses early entry. Suppressed once the visit is over or cancelled
 * so a stale manage page doesn't offer a dead button.
 */
async function resolveVideoJoinUrl(
  appointmentId: string,
  appUrl: string,
): Promise<string | null> {
  const res = await query<{
    patient_join_token_enc: string | null;
    patient_join_expires_at: Date;
    scheduled_start_at: Date | null;
    scheduled_end_at: Date | null;
    status: string;
  }>(
    `SELECT patient_join_token_enc, patient_join_expires_at,
            scheduled_start_at, scheduled_end_at, status
       FROM video_visits
      WHERE appointment_id = $1
      LIMIT 1`,
    [appointmentId],
  );
  const row = res.rows[0];
  if (!row?.patient_join_token_enc) return null;

  const state = resolveJoinState({
    now: new Date(),
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    cancelledAt: null,
    tokenExpiresAt: row.patient_join_expires_at,
    status: row.status,
  });
  if (state === "ended" || state === "cancelled" || state === "expired") return null;

  try {
    return `${appUrl}/visit/${decryptString(row.patient_join_token_enc)}`;
  } catch {
    return null;
  }
}
