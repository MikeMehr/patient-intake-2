/**
 * POST /api/booking/manage/[token]/cancel
 * Cancels the appointment and releases the slot back to OPEN.
 */

import { NextRequest, NextResponse } from "next/server";
import { hashManageToken } from "@/lib/booking-token";
import { getAppointmentByToken, cancelAppointment } from "@/lib/booking-store";
import { sendCancellationConfirmation } from "@/lib/booking-email";
import { getClinicBySlug } from "@/lib/booking-store";
import { query } from "@/lib/db";
import { decryptString } from "@/lib/encrypted-field";
import { updateOscarAppointmentStatus } from "@/lib/oscar/appointments";

export const runtime = "nodejs";

// OSCAR appointment status code for a cancelled appointment.
const OSCAR_STATUS_CANCELLED = "C";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const tokenHash = hashManageToken(token);

  const appointment = await getAppointmentByToken(tokenHash);
  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  if (appointment.cancelledAt) {
    return NextResponse.json({ error: "Appointment is already cancelled" }, { status: 409 });
  }

  const cancelled = await cancelAppointment(tokenHash);
  if (!cancelled) {
    return NextResponse.json({ error: "Unable to cancel appointment" }, { status: 500 });
  }

  // Best-effort: mark the appointment Cancelled in OSCAR too. Never block the
  // cancellation — the slot is already freed locally.
  await cancelAppointmentInOscar(appointment.id, appointment.organizationId, appointment.oscarAppointmentNo);

  // Fetch clinic timezone for email
  const orgRow = await query<{ slug: string | null }>(
    "SELECT slug FROM organizations WHERE id = $1",
    [appointment.organizationId],
  );
  const slug = orgRow.rows[0]?.slug;
  let timezone = "America/Vancouver";
  let emailFooter: string | null = null;
  let clinicName = "";
  let clinicEmail: string | null = null;
  if (slug) {
    const clinic = await getClinicBySlug(slug);
    timezone = clinic?.settings?.timezone ?? timezone;
    emailFooter = clinic?.settings?.emailFooter ?? null;
    clinicName = clinic?.name ?? "";
    clinicEmail = clinic?.email ?? null;
  }

  const physicianFullName = [appointment.physicianFirstName, appointment.physicianLastName]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");

  try {
    await sendCancellationConfirmation({
      email: appointment.email,
      patientFirstName: appointment.firstName,
      clinicName,
      physicianName: physicianFullName ? `Dr. ${physicianFullName}` : "",
      slotStartTime: appointment.slotStartTime,
      timezone,
      emailFooter,
      clinicEmail,
    });
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ success: true });
}

/**
 * Best-effort: set the OSCAR appointment's status to Cancelled. Records the
 * outcome on the appointments row (oscar_sync_status='CANCELLED' on success,
 * else an error note) but never throws — the local cancellation already stands.
 */
async function cancelAppointmentInOscar(
  appointmentId: string,
  organizationId: string,
  oscarAppointmentNo: string | null,
): Promise<void> {
  try {
    if (!oscarAppointmentNo) return; // was never synced to OSCAR

    const connRes = await query<{
      base_url: string;
      client_key: string;
      client_secret_enc: string;
      access_token_enc: string | null;
      token_secret_enc: string | null;
      status: string;
    }>(
      `SELECT base_url, client_key, client_secret_enc, access_token_enc, token_secret_enc, status
       FROM emr_connections
       WHERE organization_id = $1 AND vendor = 'OSCAR'
       LIMIT 1`,
      [organizationId],
    );
    const conn = connRes.rows[0];
    if (!conn || conn.status !== "connected" || !conn.access_token_enc || !conn.token_secret_enc) {
      return;
    }

    const res = await updateOscarAppointmentStatus({
      oscarBaseUrl: conn.base_url,
      creds: {
        clientKey: conn.client_key,
        clientSecret: decryptString(conn.client_secret_enc),
        accessToken: decryptString(conn.access_token_enc),
        tokenSecret: decryptString(conn.token_secret_enc),
      },
      appointmentNo: oscarAppointmentNo,
      status: OSCAR_STATUS_CANCELLED,
    });

    if (res.ok) {
      await query(`UPDATE appointments SET oscar_sync_status = 'CANCELLED' WHERE id = $1`, [appointmentId]);
    } else {
      console.error(`[cancel] OSCAR status update failed (${res.status}) for appointment ${appointmentId}`);
      await query(
        `UPDATE appointments SET oscar_sync_error = $1 WHERE id = $2`,
        [`OSCAR cancel ${res.status}: ${res.detail.slice(0, 180)}`, appointmentId],
      );
    }
  } catch (err) {
    console.error("[cancel] OSCAR cancel unexpected error:", err);
  }
}
