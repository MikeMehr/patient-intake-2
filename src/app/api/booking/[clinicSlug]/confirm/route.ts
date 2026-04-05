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
import { query } from "@/lib/db";

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

  // Fetch slot start time for email
  const slotRow = await query<{ start_time: Date }>(
    "SELECT start_time FROM appointment_slots WHERE id = $1",
    [slotId],
  );
  const slotStartTime = slotRow.rows[0]?.start_time?.toISOString() ?? "";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mymd.health-asisst.org";
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
    });
  } catch {
    // Email failure is non-fatal — appointment is already committed
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
