/**
 * POST /api/booking/[clinicSlug]/report-issue
 * A patient presses "online booking isn't working" — text the clinic so someone can fix it.
 * No authentication: the patient reporting the outage has no account, and often can't get past
 * this page at all.
 *
 * Body: { state?: "slot-failed" | "page-error" | "no-times" | "booking-closed" | "other" }
 *
 * Always answers { ok: true } for a known clinic, even when the alert was rate-limited or the
 * send failed. The patient's half of the promise — "someone has been told" — is kept the moment
 * the first report gets through, and showing the fifth reporter an error would just make a broken
 * page look more broken.
 */

import { NextRequest, NextResponse } from "next/server";
import { getClinicBySlug } from "@/lib/booking-store";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { resolveAppUrl } from "@/lib/app-url";
import { getRequestIp } from "@/lib/invitation-security";
import { sendBookingIssueSMS, type BookingIssueState } from "@/lib/sms";

/** One person clicking repeatedly is one report. */
const PER_IP_MAX = 1;
const PER_IP_WINDOW_SECONDS = 1800; // 30 minutes

/** During a real outage every patient hits the button — cap the texts, not the reports. */
const PER_CLINIC_MAX = 3;
const PER_CLINIC_WINDOW_SECONDS = 3600; // 1 hour

const VALID_STATES: readonly BookingIssueState[] = [
  "slot-failed",
  "page-error",
  "no-times",
  "booking-closed",
  "other",
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  const { clinicSlug } = await params;

  let body: { state?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional — a bare click is a valid report.
  }

  const state: BookingIssueState = VALID_STATES.includes(body?.state as BookingIssueState)
    ? (body.state as BookingIssueState)
    : "other";

  const clinic = await getClinicBySlug(clinicSlug);
  if (!clinic) {
    return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
  }

  const alertPhone = (process.env.BOOKING_ISSUE_ALERT_PHONE || "").trim();
  if (!alertPhone) {
    console.error(
      "[api/booking/report-issue] BOOKING_ISSUE_ALERT_PHONE not configured — report dropped",
      { clinicSlug, state },
    );
    return NextResponse.json({ ok: true });
  }

  const ipLimit = await consumeDbRateLimit({
    bucketKey: `booking-issue:ip:${getRequestIp(req.headers)}`,
    maxAttempts: PER_IP_MAX,
    windowSeconds: PER_IP_WINDOW_SECONDS,
  });
  if (!ipLimit.allowed) return NextResponse.json({ ok: true });

  const clinicLimit = await consumeDbRateLimit({
    bucketKey: `booking-issue:clinic:${clinic.id}`,
    maxAttempts: PER_CLINIC_MAX,
    windowSeconds: PER_CLINIC_WINDOW_SECONDS,
  });
  if (!clinicLimit.allowed) return NextResponse.json({ ok: true });

  const result = await sendBookingIssueSMS(alertPhone, {
    clinicName: clinic.name,
    state,
    bookingUrl: `${resolveAppUrl(req)}/booking/${clinicSlug}`,
  });

  if (!result.success) {
    console.error("[api/booking/report-issue] Alert SMS failed:", result.error);
  }

  return NextResponse.json({ ok: true });
}
