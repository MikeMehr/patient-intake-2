/**
 * GET /api/booking/[clinicSlug]/info
 * Returns clinic info, booking settings, and list of bookable physicians (public, no auth).
 */

import { NextRequest, NextResponse } from "next/server";
import { getClinicBySlug, getPhysiciansForBooking } from "@/lib/booking-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  const { clinicSlug } = await params;
  const clinic = await getClinicBySlug(clinicSlug);

  if (!clinic) {
    return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
  }

  if (!clinic.settings?.onlineBookingEnabled) {
    return NextResponse.json({ error: "Online booking is not enabled for this clinic" }, { status: 404 });
  }

  const physicians = await getPhysiciansForBooking(clinic.id);

  return NextResponse.json({
    clinic: {
      id: clinic.id,
      name: clinic.name,
      slug: clinic.slug,
      address: clinic.address,
      phone: clinic.phone,
      // Where a patient the form has to turn away is told to write. Already public — it is on the
      // confirmation emails and in the "contact the clinic" message on an ambiguous lookup.
      email: clinic.email,
      websiteUrl: clinic.websiteUrl,
    },
    settings: clinic.settings,
    physicians,
  });
}
