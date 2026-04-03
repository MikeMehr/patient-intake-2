/**
 * GET /api/booking/clinics
 * Returns all clinics with online booking enabled (public, no auth).
 */

import { NextResponse } from "next/server";
import { getBookingEnabledClinics } from "@/lib/booking-store";

export async function GET() {
  const clinics = await getBookingEnabledClinics();
  return NextResponse.json({ clinics });
}
