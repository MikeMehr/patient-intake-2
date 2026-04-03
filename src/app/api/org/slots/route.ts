/**
 * GET  /api/org/slots — List slots for the org
 * POST /api/org/slots — Create a new slot
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getSlots, createSlot } from "@/lib/booking-store";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
      return res;
    }

    const sp = request.nextUrl.searchParams;
    const dateFrom = sp.get("dateFrom") ?? new Date().toISOString().substring(0, 10);
    const dateTo = sp.get("dateTo") ?? new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10);
    const physicianId = sp.get("physicianId") ?? undefined;

    const slots = await getSlots(session.organizationId, {
      physicianId,
      dateFrom,
      dateTo,
      statusFilter: ["OPEN", "BLOCKED", "HELD", "BOOKED"],
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
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
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

    // Bulk generation: if intervalMinutes is provided, create multiple slots
    const interval = intervalMinutes ? Number(intervalMinutes) : 0;
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

      const slotIds: string[] = [];
      let slotStart = blockStart;
      while (slotStart.getTime() + intervalMs <= blockEnd.getTime()) {
        const slotEnd = new Date(slotStart.getTime() + intervalMs);
        const id = await createSlot(
          session.organizationId,
          String(physicianId),
          slotStart.toISOString(),
          slotEnd.toISOString(),
          resolvedStatus,
        );
        slotIds.push(id);
        slotStart = slotEnd;
      }

      const res = NextResponse.json({ slotIds, count: slotIds.length }, { status });
      logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
      return res;
    }

    const slotId = await createSlot(
      session.organizationId,
      String(physicianId),
      String(startTime),
      String(endTime),
      resolvedStatus,
    );

    const res = NextResponse.json({ slotId }, { status });
    logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
    return res;
  } catch {
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/slots", requestId, status, Date.now() - started);
    return res;
  }
}
