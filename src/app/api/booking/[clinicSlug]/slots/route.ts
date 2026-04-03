/**
 * GET /api/booking/[clinicSlug]/slots
 * Returns available slots for a clinic (public, no auth).
 *
 * Query params:
 *   physicianId  - filter to a specific physician (optional, omit for "any doctor")
 *   dateFrom     - ISO date "YYYY-MM-DD" (required)
 *   dateTo       - ISO date "YYYY-MM-DD" (required)
 */

import { NextRequest, NextResponse } from "next/server";
import { getClinicBySlug, getSlots } from "@/lib/booking-store";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  const { clinicSlug } = await params;
  const { searchParams } = req.nextUrl;

  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const physicianId = searchParams.get("physicianId") ?? undefined;

  if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
    return NextResponse.json(
      { error: "dateFrom and dateTo are required in YYYY-MM-DD format" },
      { status: 400 },
    );
  }

  const clinic = await getClinicBySlug(clinicSlug);
  if (!clinic || !clinic.settings?.onlineBookingEnabled) {
    return NextResponse.json({ error: "Clinic not found or booking not enabled" }, { status: 404 });
  }

  const settings = clinic.settings;

  // Enforce public booking window: check if current time is within window
  if (settings.enforceBookingWindow) {
    const now = new Date();
    const localTime = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).format(now);

    const [nowH, nowM] = localTime.split(":").map(Number);
    const [startH, startM] = settings.publicBookingStart.split(":").map(Number);
    const [endH, endM] = settings.publicBookingEnd.split(":").map(Number);

    const nowMins = nowH * 60 + nowM;
    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;

    if (nowMins < startMins || nowMins >= endMins) {
      return NextResponse.json({
        bookingClosed: true,
        message: `Online booking is currently closed. Please return between ${settings.publicBookingStart} and ${settings.publicBookingEnd} (${settings.timezone}).`,
        slots: [],
      });
    }
  }

  // Fetch OPEN slots (and optionally BLOCKED if clinic shows them)
  const statusFilter = settings.showBlockedSlots
    ? ["OPEN", "BLOCKED", "HELD", "BOOKED"]
    : ["OPEN", "HELD", "BOOKED"];

  const allSlots = await getSlots(clinic.id, {
    physicianId,
    dateFrom,
    dateTo,
    statusFilter,
  });

  // Filter slots to those within the public booking window hours
  const bookableSlots = allSlots.filter((slot) => {
    const slotLocal = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).format(new Date(slot.startTime));
    const [h, m] = slotLocal.split(":").map(Number);
    const slotMins = h * 60 + m;
    const [sh, sm] = settings.publicBookingStart.split(":").map(Number);
    const [eh, em] = settings.publicBookingEnd.split(":").map(Number);
    return slotMins >= sh * 60 + sm && slotMins < eh * 60 + em;
  });

  return NextResponse.json({ slots: bookableSlots });
}
