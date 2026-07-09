/**
 * GET /api/interview-intake/[clinicSlug]/info
 *
 * Public, no-PHI metadata for the self-serve guided interview landing page:
 * whether the feature is live for this clinic, plus display names for the header.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSelfServeInterviewConfig } from "@/lib/booking-store";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  const { clinicSlug } = await params;
  const config = await getSelfServeInterviewConfig(clinicSlug);

  if (!config) {
    return NextResponse.json({ enabled: false, clinicName: null, physicianName: null }, { status: 404 });
  }

  return NextResponse.json({
    enabled: config.enabled,
    clinicName: config.clinic.name,
    physicianName: config.physicianName,
  });
}
