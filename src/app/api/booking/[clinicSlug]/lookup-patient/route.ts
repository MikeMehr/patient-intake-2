/**
 * POST /api/booking/[clinicSlug]/lookup-patient
 * Public route — searches Oscar EMR for a patient by name + DOB.
 *
 * Security controls:
 *  - Requires an active booking hold cookie (same slot-hold mechanism as confirm).
 *    This prevents unauthenticated enumeration of Oscar patient records.
 *  - Returns minimal PHI: only a demographicNo on match (no Oscar-stored name/DOB echoed back).
 *  - Oscar errors are not forwarded to the client.
 *  - All inputs are validated before touching Oscar.
 *
 * The OSCAR search logic lives in @/lib/oscar/self-serve (shared with the
 * self-serve guided-interview intake flow).
 *
 * Body: { firstName, lastName, dateOfBirth, email? }
 *
 * Response variants:
 *   { oscarConnected: false }
 *   { oscarConnected: true, found: false }
 *   { oscarConnected: true, found: true, demographicNo: string }
 *   { oscarConnected: true, ambiguous: true, clinicEmail: string | null }
 *   { oscarConnected: true, lookupError: true, clinicEmail: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { getClinicBySlug } from "@/lib/booking-store";
import { query } from "@/lib/db";
import { normalizeOscarDob } from "@/lib/oscar/dob";
import { lookupOscarPatient } from "@/lib/oscar/self-serve";

export const runtime = "nodejs";

const HOLD_COOKIE = "booking_hold_key";
// Limit name length to prevent oversized queries reaching Oscar
const MAX_NAME_LEN = 100;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> }
) {
  try {
    const { clinicSlug } = await params;

    // Security: require an active hold cookie — proves the caller has a real slot hold
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

    const firstName = String(body.firstName ?? "").trim().slice(0, MAX_NAME_LEN);
    const lastName = String(body.lastName ?? "").trim().slice(0, MAX_NAME_LEN);
    // Normalize the submitted DOB to canonical YYYY-MM-DD before validating.
    const dateOfBirth = normalizeOscarDob(String(body.dateOfBirth ?? "").trim());
    const email = String(body.email ?? "").trim() || null;

    if (!firstName || !lastName || !dateOfBirth) {
      return NextResponse.json(
        { error: "firstName, lastName, and dateOfBirth (YYYY-MM-DD) are required" },
        { status: 400 }
      );
    }

    // Resolve clinic
    const clinic = await getClinicBySlug(clinicSlug);
    if (!clinic || !clinic.settings?.onlineBookingEnabled) {
      return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
    }

    // Verify the hold cookie actually belongs to a live hold for this clinic
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

    const result = await lookupOscarPatient(clinic.id, {
      firstName,
      lastName,
      dateOfBirth,
      email,
    });

    // For ambiguous / lookupError variants, enrich with clinic contact email so the
    // UI can show a "please contact the clinic" block.
    if (
      result.oscarConnected &&
      (("ambiguous" in result && result.ambiguous) ||
        ("lookupError" in result && result.lookupError))
    ) {
      const orgRow = await query<{ email: string | null }>(
        "SELECT email FROM organizations WHERE id = $1 LIMIT 1",
        [clinic.id]
      );
      const clinicEmail = orgRow.rows[0]?.email ?? null;
      return NextResponse.json({ ...result, clinicEmail });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[lookup-patient] Unhandled error:", err);
    // Return lookupError so the frontend blocks gracefully with clinic contact info.
    return NextResponse.json(
      { oscarConnected: true, lookupError: true, clinicEmail: null },
      { status: 200 } // intentionally 200 — client logic reads the body, not the status
    );
  }
}
