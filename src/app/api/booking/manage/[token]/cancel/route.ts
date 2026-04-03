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

  // Fetch clinic timezone for email
  const orgRow = await query<{ slug: string | null }>(
    "SELECT slug FROM organizations WHERE id = $1",
    [appointment.organizationId],
  );
  const slug = orgRow.rows[0]?.slug;
  let timezone = "America/Vancouver";
  if (slug) {
    const clinic = await getClinicBySlug(slug);
    timezone = clinic?.settings?.timezone ?? timezone;
  }

  try {
    await sendCancellationConfirmation({
      email: appointment.email,
      patientFirstName: appointment.firstName,
      clinicName: "", // will show "Your physician" if clinic name lookup fails
      physicianName: `Dr. ${appointment.physicianFirstName} ${appointment.physicianLastName}`,
      slotStartTime: appointment.slotStartTime,
      timezone,
    });
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ success: true });
}
