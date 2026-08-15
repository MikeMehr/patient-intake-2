/**
 * GET  /api/org/slots — List slots for the org
 * POST /api/org/slots — Create a new slot
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getOrgAdminContext } from "@/lib/auth-helpers";
import { getSlots, createSlot, getBookingSettingsByOrgId, findOverlappingSlots } from "@/lib/booking-store";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { checkBusinessHours, partsInZone } from "@/lib/business-hours";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    const orgContext = await getOrgAdminContext(session);
    if (!orgContext) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
      return res;
    }

    const sp = request.nextUrl.searchParams;
    const dateFrom = sp.get("dateFrom") ?? new Date().toISOString().substring(0, 10);
    const dateTo = sp.get("dateTo") ?? new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10);
    const physicianId = sp.get("physicianId") ?? undefined;

    // Interpret the From/To day boundaries in the clinic's local timezone so the
    // list matches the dates the admin sees (not UTC-shifted by ~a day).
    const settings = await getBookingSettingsByOrgId(orgContext.organizationId);

    const slots = await getSlots(orgContext.organizationId, {
      physicianId,
      dateFrom,
      dateTo,
      statusFilter: ["OPEN", "BLOCKED", "HELD", "BOOKED"],
      timezone: settings?.timezone,
    });

    const res = NextResponse.json({ slots });
    logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
    return res;
  } catch {
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
    return res;
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 201;

  try {
    const session = await getCurrentSession();
    const orgContext = await getOrgAdminContext(session);
    if (!orgContext) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json();
    const { physicianId, startTime, endTime, slotStatus, intervalMinutes } =
      body as Record<string, string | number | undefined>;

    if (!physicianId || !startTime || !endTime) {
      status = 400;
      const res = NextResponse.json({ error: "physicianId, startTime, and endTime are required" }, { status });
      logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
      return res;
    }

    if (!ISO_RE.test(String(startTime)) || !ISO_RE.test(String(endTime))) {
      status = 400;
      const res = NextResponse.json({ error: "startTime and endTime must be ISO datetime strings" }, { status });
      logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
      return res;
    }

    const resolvedStatus: "OPEN" | "BLOCKED" =
      slotStatus === "BLOCKED" ? "BLOCKED" : "OPEN";

    // Build the list of slot ranges to create (single, or bulk by interval).
    const interval = intervalMinutes ? Number(intervalMinutes) : 0;
    const ranges: { start: Date; end: Date }[] = [];
    if (interval > 0) {
      const blockStart = new Date(String(startTime));
      const blockEnd = new Date(String(endTime));
      const intervalMs = interval * 60 * 1000;

      if (blockEnd.getTime() <= blockStart.getTime() + intervalMs) {
        status = 400;
        const res = NextResponse.json({ error: "Time range is shorter than the slot interval" }, { status });
        logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
        return res;
      }

      let slotStart = blockStart;
      while (slotStart.getTime() + intervalMs <= blockEnd.getTime()) {
        const slotEnd = new Date(slotStart.getTime() + intervalMs);
        ranges.push({ start: slotStart, end: slotEnd });
        slotStart = slotEnd;
      }
    } else {
      ranges.push({ start: new Date(String(startTime)), end: new Date(String(endTime)) });
    }

    // Keep every slot inside clinic hours, evaluated in the clinic's own
    // timezone (the wire format is UTC). Mirrors the check the Add Slot form
    // does, so an AM/PM slip can't reach the database via a direct POST either.
    const settings = await getBookingSettingsByOrgId(orgContext.organizationId);
    const tz = settings?.timezone || "America/Vancouver";
    const hoursError = checkBusinessHours(
      partsInZone(ranges[0]!.start, tz),
      partsInZone(ranges[ranges.length - 1]!.end, tz),
    );
    if (hoursError) {
      status = 400;
      const res = NextResponse.json({ error: hoursError }, { status });
      logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
      return res;
    }

    // Unless the caller explicitly overrides, warn about overlaps with existing
    // slots for this physician instead of creating them.
    const allowOverlap = (body as Record<string, unknown>).allowOverlap === true;
    if (!allowOverlap) {
      const overlaps = await findOverlappingSlots(
        orgContext.organizationId,
        String(physicianId),
        ranges,
      );
      if (overlaps.length > 0) {
        status = 409;
        const res = NextResponse.json({ error: "overlap", overlaps }, { status });
        logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
        return res;
      }
    }

    const slotIds: string[] = [];
    for (const r of ranges) {
      const id = await createSlot(
        orgContext.organizationId,
        String(physicianId),
        r.start.toISOString(),
        r.end.toISOString(),
        resolvedStatus,
      );
      slotIds.push(id);
    }

    const res =
      interval > 0
        ? NextResponse.json({ slotIds, count: slotIds.length }, { status })
        : NextResponse.json({ slotId: slotIds[0] }, { status });
    logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
    return res;
  } catch {
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
    return res;
  }
}
