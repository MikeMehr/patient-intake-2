/**
 * Send a patient their video-visit join link, on demand from the provider console.
 *
 * This exists because the day-sheet button opens rooms for appointments that were entered
 * straight into OSCAR — those patients never went through online booking, so no confirmation
 * email carrying a link was ever sent. It also covers the ordinary case of a patient who can't
 * find theirs.
 *
 * Three things this route is careful about:
 *
 *   1. The destination is whatever the provider confirms, not whatever we guessed. The console
 *      prefills from the chart, but a typo here mails a live join credential to a stranger, so
 *      the value is always posted back explicitly rather than resolved server-side.
 *   2. Suppression is reported as suppression. Every legacy sender returns success when
 *      HIPAA_MODE is on; a provider watching for confirmation would then believe a patient had
 *      been contacted who hadn't. The response says `sent: false, reason: "suppressed"` and
 *      hands back the URL so it can be read out instead.
 *   3. The destination is never stored or logged — the audit row records the channel only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { resolveAppUrl } from "@/lib/app-url";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { sendVideoLinkSMS, toE164 } from "@/lib/sms";
import { sendVideoVisitLinkEmail } from "@/lib/booking-email";
import { query } from "@/lib/db";
import {
  getJoinUrlForResend,
  getVisitById,
  recordLinkSend,
} from "@/lib/video/video-store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ visitId: string }> },
) {
  const session = await getCurrentSession();
  if (!session?.organizationId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { visitId } = await params;
  if (!UUID_RE.test(visitId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { channel, destination } = (body || {}) as {
    channel?: string;
    destination?: string;
  };

  if (channel !== "sms" && channel !== "email") {
    return NextResponse.json({ error: "Choose SMS or email." }, { status: 400 });
  }
  const dest = typeof destination === "string" ? destination.trim() : "";
  if (!dest) {
    return NextResponse.json({ error: "A destination is required." }, { status: 400 });
  }
  if (channel === "email" && !EMAIL_RE.test(dest)) {
    return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
  }
  if (channel === "sms" && !/^\+\d{10,15}$/.test(toE164(dest))) {
    return NextResponse.json({ error: "That doesn't look like a phone number." }, { status: 400 });
  }

  // Org-scoped: a session at one clinic cannot send another clinic's link.
  const visit = await getVisitById(visitId, session.organizationId);
  if (!visit) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (visit.status === "CANCELLED" || visit.cancelledAt) {
    return NextResponse.json(
      { error: "This appointment was cancelled." },
      { status: 409 },
    );
  }

  // Per-visit, not per-provider: the thing worth bounding is how many messages one patient can
  // be made to receive, whoever presses the button.
  const limit = await consumeDbRateLimit({
    bucketKey: `video-link:${visitId}`,
    maxAttempts: 5,
    windowSeconds: 900,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "This link has been sent several times already. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const appUrl = resolveAppUrl(request);
  const joinUrl = await getJoinUrlForResend(visitId, session.organizationId, appUrl);
  if (!joinUrl) {
    return NextResponse.json(
      {
        error:
          "This visit's link can't be regenerated. Start a new video visit for this appointment.",
      },
      { status: 409 },
    );
  }

  const clinic = await loadClinicContext(session.organizationId, visit.physicianId);

  const result =
    channel === "sms"
      ? await sendVideoLinkSMS(dest, { clinicName: clinic.clinicName, joinUrl })
      : await sendEmail({ dest, joinUrl, visit, clinic });

  const physicianId =
    session.userType === "provider" ? getEffectivePhysicianId(session) : null;

  if (result.outcome === "sent") {
    await recordLinkSend(visitId, channel);
  }

  // Audited whatever the outcome — a failed or suppressed send is exactly the thing you want a
  // record of when a patient says they were never contacted. Channel only; never the address.
  try {
    await logPhysicianPhiAudit({
      physicianId,
      eventType: "video_visit_link_send",
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
      metadata: { visitId, channel, outcome: result.outcome },
    });
  } catch {
    // Audit failure must not swallow a send that already happened.
  }

  if (result.outcome === "suppressed") {
    return NextResponse.json({
      sent: false,
      reason: "suppressed",
      // Handed back so the provider can read it to the patient over the phone. This is the one
      // place the join URL is returned outside the creating request, and it goes only to an
      // authenticated provider in their own organization.
      joinUrl,
      message:
        "Messaging is switched off on this deployment. Read the link to the patient instead.",
    });
  }
  if (result.outcome === "failed") {
    return NextResponse.json(
      { sent: false, reason: "failed", error: "The message could not be sent." },
      { status: 502 },
    );
  }

  return NextResponse.json({ sent: true, channel });
}

type SendOutcome =
  | { outcome: "sent" }
  | { outcome: "suppressed"; reason: string }
  | { outcome: "failed"; error: string };

/** Adapts the email sender's boolean-ish result onto the SMS sender's three-state outcome. */
async function sendEmail(args: {
  dest: string;
  joinUrl: string;
  visit: { patientDisplayName: string | null; scheduledStartAt: Date | null };
  clinic: { clinicName: string; clinicEmail: string | null; physicianName: string | null; timezone: string; emailFooter: string | null };
}): Promise<SendOutcome> {
  const res = await sendVideoVisitLinkEmail({
    email: args.dest,
    patientFirstName: args.visit.patientDisplayName?.split(" ")[0] ?? null,
    clinicName: args.clinic.clinicName,
    physicianName: args.clinic.physicianName,
    joinUrl: args.joinUrl,
    slotStartTime: args.visit.scheduledStartAt?.toISOString() ?? null,
    timezone: args.clinic.timezone,
    emailFooter: args.clinic.emailFooter,
    clinicEmail: args.clinic.clinicEmail,
  });
  if (res.sent) return { outcome: "sent" };
  if (res.suppressed) return { outcome: "suppressed", reason: "email_suppressed" };
  return { outcome: "failed", error: res.error ?? "send_failed" };
}

async function loadClinicContext(organizationId: string, physicianId: string | null) {
  const orgRes = await query<{
    name: string;
    email: string | null;
    timezone: string | null;
    email_footer: string | null;
  }>(
    `SELECT o.name, o.email, bs.timezone, bs.email_footer
       FROM organizations o
       LEFT JOIN booking_settings bs ON bs.organization_id = o.id
      WHERE o.id = $1`,
    [organizationId],
  );
  const org = orgRes.rows[0];

  let physicianName: string | null = null;
  if (physicianId) {
    const p = await query<{ first_name: string; last_name: string }>(
      `SELECT first_name, last_name FROM physicians WHERE id = $1`,
      [physicianId],
    );
    if (p.rows[0]) physicianName = `Dr. ${p.rows[0].first_name} ${p.rows[0].last_name}`.trim();
  }

  return {
    clinicName: org?.name ?? "Your clinic",
    clinicEmail: org?.email ?? null,
    timezone: org?.timezone ?? "America/Vancouver",
    emailFooter: org?.email_footer ?? null,
    physicianName,
  };
}
