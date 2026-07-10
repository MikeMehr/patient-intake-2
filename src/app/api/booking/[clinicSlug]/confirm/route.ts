/**
 * POST /api/booking/[clinicSlug]/confirm
 * Validates the hold, creates the appointment, sends confirmation email.
 *
 * Body: {
 *   slotId, firstName, lastName, dateOfBirth, email, coverageType,
 *   province?, healthCardNumber?, billingNote?, consentGiven
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getClinicBySlug, getPhysiciansForBooking, confirmAppointment } from "@/lib/booking-store";
import { generateManageToken } from "@/lib/booking-token";
import { sendBookingConfirmation } from "@/lib/booking-email";
import { sendBookingAlertSMS } from "@/lib/sms";
import { getPhysicianPhone } from "@/lib/physician-lookup";
import { query } from "@/lib/db";
import { decryptString } from "@/lib/encrypted-field";
import { createOscarAppointment, toClinicLocalParts } from "@/lib/oscar/appointments";

export const runtime = "nodejs";

const HOLD_COOKIE = "booking_hold_key";
const COVERAGE_TYPES = [
  "CANADIAN_HEALTH_CARD",
  "PRIVATE_PAY",
  "TRAVEL_INSURANCE",
  "UNINSURED",
  "EXISTING_OSCAR_PATIENT",
] as const;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  const { clinicSlug } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    slotId,
    firstName,
    lastName,
    dateOfBirth,
    email,
    coverageType,
    province,
    healthCardNumber,
    billingNote,
    consentGiven,
    oscarDemographicNo,
  } = body as Record<string, string | boolean | undefined>;

  // Validate required fields
  if (!slotId || !firstName || !lastName || !dateOfBirth || !email || !coverageType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!DOB_RE.test(String(dateOfBirth))) {
    return NextResponse.json({ error: "dateOfBirth must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!COVERAGE_TYPES.includes(coverageType as (typeof COVERAGE_TYPES)[number])) {
    return NextResponse.json({ error: "Invalid coverageType" }, { status: 400 });
  }
  if (!consentGiven) {
    return NextResponse.json({ error: "Patient consent is required" }, { status: 400 });
  }

  // Read hold session key from cookie
  const sessionKey = req.cookies.get(HOLD_COOKIE)?.value;
  if (!sessionKey) {
    return NextResponse.json(
      { error: "No active hold found. Please select a slot again." },
      { status: 409 },
    );
  }

  const clinic = await getClinicBySlug(clinicSlug);
  if (!clinic || !clinic.settings?.onlineBookingEnabled) {
    return NextResponse.json({ error: "Clinic not found or booking not enabled" }, { status: 404 });
  }

  // Enforce health card requirement (not applicable to existing Oscar patients)
  if (
    clinic.settings.healthCardRequired &&
    coverageType === "CANADIAN_HEALTH_CARD" &&
    !healthCardNumber
  ) {
    return NextResponse.json({ error: "Health card number is required for this clinic" }, { status: 400 });
  }

  const { raw: manageTokenRaw, hash: manageTokenHash, expiresAt: manageTokenExpiresAt } =
    generateManageToken();

  const result = await confirmAppointment(String(slotId), clinic.id, sessionKey, {
    firstName: String(firstName),
    lastName: String(lastName),
    dateOfBirth: String(dateOfBirth),
    email: String(email),
    coverageType: String(coverageType),
    province: province ? String(province) : undefined,
    healthCardNumber: healthCardNumber ? String(healthCardNumber) : undefined,
    billingNote: billingNote ? String(billingNote) : undefined,
    manageTokenHash,
    manageTokenExpiresAt,
    oscarDemographicNo: oscarDemographicNo ? String(oscarDemographicNo) : undefined,
  });

  if (!result) {
    return NextResponse.json(
      { error: "Your hold has expired or the slot is no longer available. Please start over." },
      { status: 409 },
    );
  }

  // Fetch physician name for email
  const physicians = await getPhysiciansForBooking(clinic.id);
  const physician = physicians.find((p) => p.id === result.physicianId);

  // Fetch slot start/end time for email + OSCAR sync
  const slotRow = await query<{ start_time: Date; end_time: Date }>(
    "SELECT start_time, end_time FROM appointment_slots WHERE id = $1",
    [slotId],
  );
  const slotStart = slotRow.rows[0]?.start_time ?? null;
  const slotEnd = slotRow.rows[0]?.end_time ?? null;
  const slotStartTime = slotStart?.toISOString() ?? "";

  // Best-effort: push the booked appointment into OSCAR so it appears on the
  // provider's day sheet. Never block the booking — it's already committed.
  await syncAppointmentToOscar({
    appointmentId: result.appointmentId,
    physicianId: result.physicianId,
    organizationId: clinic.id,
    timezone: clinic.settings.timezone,
    slotStart,
    slotEnd,
    demographicNo: oscarDemographicNo ? String(oscarDemographicNo) : undefined,
    patientFirstName: String(firstName),
    patientLastName: String(lastName),
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mymd.health-assist.org";
  const manageUrl = `${appUrl}/booking/manage/${manageTokenRaw}`;

  // Send confirmation email (best-effort, don't fail booking if email fails)
  try {
    await sendBookingConfirmation({
      email: String(email),
      patientFirstName: String(firstName),
      clinicName: clinic.name,
      physicianName: physician?.displayName ?? "Your physician",
      slotStartTime,
      slotEndTime: "",
      timezone: clinic.settings.timezone,
      manageUrl,
      emailFooter: clinic.settings.emailFooter,
      clinicEmail: clinic.email,
    });
  } catch {
    // Email failure is non-fatal — appointment is already committed
  }

  // Notify the physician by SMS (best-effort, never blocks the booking)
  try {
    const physicianPhone = await getPhysicianPhone(result.physicianId);
    if (physicianPhone) {
      const dateLabel = slotStart
        ? new Intl.DateTimeFormat("en-CA", {
            timeZone: clinic.settings.timezone,
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }).format(slotStart)
        : "";
      await sendBookingAlertSMS(physicianPhone, {
        patientName: `${firstName} ${lastName}`,
        clinicName: clinic.name,
        dateLabel,
      });
    }
  } catch {
    // SMS failure is non-fatal — appointment is already committed
  }

  const response = NextResponse.json({
    success: true,
    appointmentId: result.appointmentId,
    manageToken: manageTokenRaw,
    manageUrl,
  });

  // Clear the hold cookie
  response.cookies.set(HOLD_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}

/**
 * Best-effort creation of the appointment in OSCAR's schedule, recording the
 * outcome on the appointments row (oscar_sync_status). This never throws — a
 * failure here only flags the appointment as not-synced so staff can enter it
 * manually; the patient's booking has already been committed.
 */
async function syncAppointmentToOscar(args: {
  appointmentId: string;
  physicianId: string;
  organizationId: string;
  timezone: string;
  slotStart: Date | null;
  slotEnd: Date | null;
  demographicNo?: string;
  patientFirstName: string;
  patientLastName: string;
}): Promise<void> {
  const setSync = async (status: "SYNCED" | "FAILED" | "SKIPPED", apptNo: string | null, err: string | null) => {
    try {
      await query(
        `UPDATE appointments SET oscar_sync_status = $1, oscar_appointment_no = $2, oscar_sync_error = $3 WHERE id = $4`,
        [status, apptNo, err, args.appointmentId],
      );
    } catch {
      // Flag write is itself best-effort.
    }
  };

  try {
    if (!args.demographicNo || !/^\d+$/.test(args.demographicNo)) {
      console.error(`[confirm] OSCAR sync skipped — no demographicNo for appointment ${args.appointmentId}`);
      await setSync("SKIPPED", null, "No OSCAR patient (demographic) number");
      return;
    }
    if (!args.slotStart || !args.slotEnd) {
      await setSync("SKIPPED", null, "Slot times unavailable");
      return;
    }

    // Physician → OSCAR provider number
    const physRow = await query<{ oscar_provider_no: string | null }>(
      `SELECT oscar_provider_no FROM physicians WHERE id = $1`,
      [args.physicianId],
    );
    const providerNo = physRow.rows[0]?.oscar_provider_no?.trim();
    if (!providerNo) {
      console.error(`[confirm] OSCAR sync skipped — physician ${args.physicianId} has no oscar_provider_no`);
      await setSync("SKIPPED", null, "Physician has no OSCAR provider number");
      return;
    }

    // Org OSCAR connection
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
      [args.organizationId],
    );
    const conn = connRes.rows[0];
    if (!conn || conn.status !== "connected" || !conn.access_token_enc || !conn.token_secret_enc) {
      await setSync("SKIPPED", null, "OSCAR not connected for this clinic");
      return;
    }

    const { date, time } = toClinicLocalParts(args.slotStart, args.timezone);
    const durationMinutes = Math.max(
      1,
      Math.round((args.slotEnd.getTime() - args.slotStart.getTime()) / 60000),
    );

    const res = await createOscarAppointment({
      oscarBaseUrl: conn.base_url,
      creds: {
        clientKey: conn.client_key,
        clientSecret: decryptString(conn.client_secret_enc),
        accessToken: decryptString(conn.access_token_enc),
        tokenSecret: decryptString(conn.token_secret_enc),
      },
      providerNo,
      demographicNo: Number(args.demographicNo),
      appointmentDate: date,
      startTime: time,
      durationMinutes,
      name: `${args.patientLastName}, ${args.patientFirstName}`,
      reason: "Online booking",
      notes: "Booked via online scheduling",
    });

    if (res.ok) {
      await setSync("SYNCED", res.appointmentNo, null);
    } else {
      console.error(`[confirm] OSCAR appointment create failed (${res.status}) for appointment ${args.appointmentId}`);
      await setSync("FAILED", null, `OSCAR ${res.status}: ${res.detail.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("[confirm] OSCAR sync unexpected error:", err);
    await setSync("FAILED", null, "Unexpected error during OSCAR sync");
  }
}
