/**
 * Invite a patient to a video call that has no appointment behind it.
 *
 * The booking flow and the OSCAR day-sheet button both start from an appointment. This is for
 * when there isn't one — a patient phones in, or a follow-up needs five minutes of face time and
 * nobody wants to create a fake booking to make a link exist.
 *
 * Creates the room and sends the link in a single call, deliberately: two round trips would mean
 * a visit could be created and then stranded with nobody holding its link, which is exactly the
 * orphan the old key constraint was there to prevent.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { resolveAppUrl } from "@/lib/app-url";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { sendVideoLinkSMS, toE164 } from "@/lib/sms";
import { sendVideoVisitLinkEmail } from "@/lib/booking-email";
import { isDailyConfigured } from "@/lib/video/daily";
import { createAdHocVisit, recordLinkSend } from "@/lib/video/video-store";
import { query } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LEN = 80;

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session?.organizationId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!isDailyConfigured()) {
    return NextResponse.json(
      { error: "Video visits are not configured for this deployment." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { patientName, channel, destination } = (body || {}) as {
    patientName?: string;
    channel?: string;
    destination?: string;
  };

  if (channel !== "sms" && channel !== "email" && channel !== "link") {
    return NextResponse.json({ error: "Choose text, email, or a copyable link." }, { status: 400 });
  }

  const dest = typeof destination === "string" ? destination.trim() : "";
  if (channel === "email" && !EMAIL_RE.test(dest)) {
    return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
  }
  if (channel === "sms" && !/^\+\d{10,15}$/.test(toE164(dest))) {
    return NextResponse.json({ error: "That doesn't look like a phone number." }, { status: 400 });
  }

  // Name is for the provider's own screen and the call tile — never a lookup key, so it is only
  // length-capped and stripped of the characters that would make a mess of an email subject.
  const name =
    typeof patientName === "string"
      ? patientName.replace(/[\x00-\x1F\x7F<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LEN)
      : "";

  // Per-organization: what is worth bounding is how many invites a clinic can emit, since each
  // one mints a room and, on the sending paths, a message to a real person.
  const limit = await consumeDbRateLimit({
    bucketKey: `video-invite:${session.organizationId}`,
    maxAttempts: 20,
    windowSeconds: 900,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many invites just now. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const physicianId =
    session.userType === "provider" ? getEffectivePhysicianId(session) : null;

  const created = await createAdHocVisit({
    organizationId: session.organizationId,
    physicianId,
    patientDisplayName: name || null,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.detail }, { status: created.status });
  }
  if (!created.joinTokenRaw) {
    // insertVisit only omits the raw token when it collapsed onto an existing row, which cannot
    // happen for an ad-hoc visit — it has no key to collide on. Fail loudly rather than hand back
    // an invite with no link.
    return NextResponse.json({ error: "Could not create the invite link." }, { status: 500 });
  }

  const joinUrl = `${resolveAppUrl(request)}/visit/${created.joinTokenRaw}`;
  const clinic = await loadClinic(session.organizationId);

  let sent = false;
  let suppressed = false;
  let sendError: string | null = null;

  if (channel === "sms") {
    const res = await sendVideoLinkSMS(dest, { clinicName: clinic.name, joinUrl });
    sent = res.outcome === "sent";
    suppressed = res.outcome === "suppressed";
    if (res.outcome === "failed") sendError = "The text could not be sent.";
  } else if (channel === "email") {
    const res = await sendVideoVisitLinkEmail({
      email: dest,
      patientFirstName: name.split(" ")[0] || null,
      clinicName: clinic.name,
      joinUrl,
      emailFooter: clinic.emailFooter,
      clinicEmail: clinic.email,
    });
    sent = res.sent;
    suppressed = !!res.suppressed;
    if (!res.sent && !res.suppressed) sendError = "The email could not be sent.";
  }

  if (sent) await recordLinkSend(created.visit.id, channel as "sms" | "email");

  try {
    await logPhysicianPhiAudit({
      physicianId,
      eventType: "video_visit_invite_created",
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
      // Channel and outcome only — never the address the link went to.
      metadata: { visitId: created.visit.id, channel, sent, suppressed },
    });
  } catch {
    // An audit failure must not lose an invite that already went out.
  }

  return NextResponse.json({
    visitId: created.visit.id,
    // Always returned. Even on a successful send the clinic may want to read it out, and on a
    // suppressed or failed send it is the only way the patient gets in.
    joinUrl,
    providerUrl: `/physician/video?visitId=${created.visit.id}`,
    sent,
    suppressed,
    error: sendError,
  });
}

async function loadClinic(organizationId: string) {
  const res = await query<{ name: string; email: string | null; email_footer: string | null }>(
    `SELECT o.name, o.email, bs.email_footer
       FROM organizations o
       LEFT JOIN booking_settings bs ON bs.organization_id = o.id
      WHERE o.id = $1`,
    [organizationId],
  );
  const row = res.rows[0];
  return {
    name: row?.name ?? "Your clinic",
    email: row?.email ?? null,
    emailFooter: row?.email_footer ?? null,
  };
}
