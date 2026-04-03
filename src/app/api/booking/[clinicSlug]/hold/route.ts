/**
 * POST /api/booking/[clinicSlug]/hold
 * Places a 5-minute hold on a slot. Returns a session key stored in an httpOnly cookie.
 *
 * Body: { slotId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getClinicBySlug, holdSlot } from "@/lib/booking-store";

const HOLD_MINUTES = 5;
const HOLD_COOKIE = "booking_hold_key";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  const { clinicSlug } = await params;

  let body: { slotId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { slotId } = body;
  if (!slotId || typeof slotId !== "string") {
    return NextResponse.json({ error: "slotId is required" }, { status: 400 });
  }

  const clinic = await getClinicBySlug(clinicSlug);
  if (!clinic || !clinic.settings?.onlineBookingEnabled) {
    return NextResponse.json({ error: "Clinic not found or booking not enabled" }, { status: 404 });
  }

  const sessionKey = randomBytes(32).toString("hex");
  const held = await holdSlot(slotId, clinic.id, sessionKey, HOLD_MINUTES);

  if (!held) {
    return NextResponse.json(
      { error: "This slot is no longer available. Please select another time." },
      { status: 409 },
    );
  }

  const heldUntil = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);

  const response = NextResponse.json({
    held: true,
    slotId,
    heldUntil: heldUntil.toISOString(),
  });

  response.cookies.set(HOLD_COOKIE, sessionKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: heldUntil,
  });

  return response;
}
