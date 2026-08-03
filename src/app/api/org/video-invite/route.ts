/**
 * Send a patient the clinic's Doxy waiting-room link.
 *
 * For the patient on the phone who needs the link now, with no appointment to hang it on. Since
 * moving to Doxy there is nothing to create — one permanent room per provider — so this is a
 * lookup and a send, not a room-minting endpoint.
 *
 * The provider is chosen explicitly rather than taken from the session, because the person doing
 * this is usually reception sending on someone else's behalf.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { sendVideoLinkSMS, toE164 } from "@/lib/sms";
import { sendVideoVisitLinkEmail } from "@/lib/booking-email";
import { query } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LEN = 80;

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session?.organizationId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { patientName, channel, destination, physicianId } = (body || {}) as {
    patientName?: string;
    channel?: string;
    destination?: string;
    physicianId?: string;
  };

  if (channel !== "sms" && channel !== "email") {
    return NextResponse.json({ error: "Choose text or email." }, { status: 400 });
  }

  const dest = typeof destination === "string" ? destination.trim() : "";
  if (channel === "email" && !EMAIL_RE.test(dest)) {
    return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
  }
  if (channel === "sms" && !/^\+\d{10,15}$/.test(toE164(dest))) {
    return NextResponse.json({ error: "That doesn't look like a phone number." }, { status: 400 });
  }

  // Named provider, else the signed-in one. Org-scoped either way, so an id from another clinic
  // simply doesn't resolve.
  const targetPhysicianId =
    typeof physicianId === "string" && UUID_RE.test(physicianId)
      ? physicianId
      : session.userType === "provider"
        ? getEffectivePhysicianId(session)
        : null;

  if (!targetPhysicianId) {
    return NextResponse.json({ error: "Choose which provider to send." }, { status: 400 });
  }

  const room = await query<{
    doxy_room_url: string | null;
    first_name: string;
    last_name: string;
  }>(
    `SELECT doxy_room_url, first_name, last_name
       FROM physicians WHERE id = $1 AND organization_id = $2`,
    [targetPhysicianId, session.organizationId],
  );
  const physician = room.rows[0];
  if (!physician) {
    return NextResponse.json({ error: "Provider not found." }, { status: 404 });
  }
  if (!physician.doxy_room_url) {
    return NextResponse.json(
      { error: "That provider has no Doxy link set. Add it on their provider record." },
      { status: 409 },
    );
  }

  // Per-organization: what is worth bounding is how many messages a clinic can emit, since each
  // one reaches a real person.
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

  const name =
    typeof patientName === "string"
      ? patientName.replace(/[\x00-\x1F\x7F<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LEN)
      : "";

  const clinic = await loadClinic(session.organizationId);
  const joinUrl = physician.doxy_room_url;

  let sent = false;
  let suppressed = false;
  let sendError: string | null = null;

  if (channel === "sms") {
    const res = await sendVideoLinkSMS(dest, { clinicName: clinic.name, joinUrl });
    sent = res.outcome === "sent";
    suppressed = res.outcome === "suppressed";
    if (res.outcome === "failed") sendError = "The text could not be sent.";
  } else {
    const res = await sendVideoVisitLinkEmail({
      email: dest,
      patientFirstName: name.split(" ")[0] || null,
      clinicName: clinic.name,
      physicianName: `Dr. ${physician.first_name} ${physician.last_name}`.trim(),
      joinUrl,
      emailFooter: clinic.emailFooter,
      clinicEmail: clinic.email,
    });
    sent = res.sent;
    suppressed = !!res.suppressed;
    if (!res.sent && !res.suppressed) sendError = "The email could not be sent.";
  }

  try {
    await logPhysicianPhiAudit({
      physicianId: targetPhysicianId,
      eventType: "video_room_link_sent",
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
      // Channel and outcome only — never the address it went to.
      metadata: { channel, sent, suppressed },
    });
  } catch {
    // An audit failure must not lose a message that already went out.
  }

  return NextResponse.json({
    // Returned whatever happened: on a suppressed or failed send it is the only way the patient
    // gets in, and even on success the clinic may want to read it out.
    joinUrl,
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
