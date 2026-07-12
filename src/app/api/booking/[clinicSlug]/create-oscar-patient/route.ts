/**
 * POST /api/booking/[clinicSlug]/create-oscar-patient
 * Public route — creates a new patient demographic in Oscar EMR.
 * Called only when a patient was not found during lookup.
 *
 * Security controls:
 *  - Requires an active booking hold cookie (same gate as lookup-patient).
 *  - Validates all inputs strictly before sending to Oscar.
 *  - Returns only the demographicNo — no Oscar PHI echoed back.
 *
 * The OSCAR write logic lives in @/lib/oscar/self-serve (shared with the
 * self-serve guided-interview intake flow).
 *
 * Body: {
 *   firstName, lastName, dateOfBirth, email?,
 *   phone, address, city, province, postal, gender?,
 *   healthCardNumber?, healthCardProvince?
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getClinicBySlug } from "@/lib/booking-store";
import { query } from "@/lib/db";
import { createOscarDemographic } from "@/lib/oscar/self-serve";

export const runtime = "nodejs";

const HOLD_COOKIE = "booking_hold_key";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> }
) {
  try {
    const { clinicSlug } = await params;

    // Security: require an active hold cookie
    const sessionKey = req.cookies.get(HOLD_COOKIE)?.value;
    if (!sessionKey) {
      return NextResponse.json(
        { error: "No active booking hold. Please select a time slot first." },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Resolve clinic
    const clinic = await getClinicBySlug(clinicSlug);
    if (!clinic || !clinic.settings?.onlineBookingEnabled) {
      return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
    }

    // Verify the hold cookie belongs to a live hold for this clinic
    const holdCheck = await query<{ id: string }>(
      `SELECT s.id FROM appointment_slots s
       WHERE s.organization_id = $1
         AND s.status = 'HELD'
         AND s.held_session_key = $2
         AND s.held_until > NOW()
       LIMIT 1`,
      [clinic.id, sessionKey]
    );
    if (holdCheck.rows.length === 0) {
      return NextResponse.json(
        { error: "Hold not found or expired. Please select a time slot again." },
        { status: 403 }
      );
    }

    const result = await createOscarDemographic(clinic.id, {
      firstName: String(body.firstName ?? ""),
      lastName: String(body.lastName ?? ""),
      dateOfBirth: String(body.dateOfBirth ?? ""),
      phone: String(body.phone ?? ""),
      address: String(body.address ?? ""),
      city: String(body.city ?? ""),
      province: String(body.province ?? ""),
      postal: String(body.postal ?? ""),
      email: body.email != null ? String(body.email) : null,
      gender: body.gender != null ? String(body.gender) : null,
      healthCardNumber: body.healthCardNumber != null ? String(body.healthCardNumber) : null,
      healthCardProvince: body.healthCardProvince != null ? String(body.healthCardProvince) : null,
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ demographicNo: result.demographicNo });
  } catch (err) {
    console.error("[create-oscar-patient] Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please contact the clinic." },
      { status: 500 }
    );
  }
}
