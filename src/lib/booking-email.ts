import { Resend } from "resend";
import {
  MODALITY_LABEL,
  MODALITY_NOTE,
  normalizeModality,
  type AppointmentModality,
} from "@/lib/appointment-modality";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
}

/**
 * The set of email domains verified for sending in Resend. Derived from the
 * platform sender's domain, plus any listed in RESEND_VERIFIED_DOMAINS
 * (comma-separated) — add a clinic's domain there once it's verified in Resend.
 */
function verifiedDomains(): string[] {
  const explicit = (process.env.RESEND_VERIFIED_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const platformDomain = getFromEmail().split("@")[1]?.toLowerCase();
  return [...new Set([...explicit, ...(platformDomain ? [platformDomain] : [])])];
}

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Chooses the From header (and optional Reply-To) for a clinic message.
 *
 * When the clinic's email domain is verified in Resend, the message is sent
 * *from* the clinic address (e.g. `MyMD Telehealth <info@mymdonline.ca>`).
 * When it isn't verified — Resend would reject that send — we fall back to the
 * platform's verified sender (keeping the clinic name) and set Reply-To to the
 * clinic email so patient replies still reach the clinic. This upgrades to a
 * true clinic From automatically once the domain is verified.
 */
function resolveSender(
  clinicName?: string | null,
  clinicEmail?: string | null,
): { from: string; replyTo?: string } {
  const name = (clinicName ?? "").trim().replace(/["\\<>]/g, "");
  const addr = (clinicEmail ?? "").trim();
  const platformFrom = getFromEmail();
  const withName = (address: string) => (name ? `${name} <${address}>` : address);

  if (!addr) return { from: withName(platformFrom) };

  if (verifiedDomains().includes(domainOf(addr))) {
    return { from: withName(addr) };
  }

  return { from: withName(platformFrom), replyTo: addr };
}

/**
 * Escapes author-supplied text for safe interpolation into an HTML email, and
 * preserves the author's line breaks.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

/**
 * Renders the clinic's configured plain-text email footer as a safe HTML block.
 * Escapes HTML and preserves the author's line breaks. Returns "" when no footer
 * is configured so callers can concatenate unconditionally.
 */
function renderFooter(footer?: string | null): string {
  const text = (footer ?? "").trim();
  if (!text) return "";
  const escaped = escapeHtml(text);
  return `
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
        <div style="font-size:12px;color:#888;line-height:1.5">${escaped}</div>`;
}

/**
 * The join button for a video visit.
 *
 * Absent whenever the room could not be created at booking time — a Daily outage, or video not
 * configured. That is deliberately not an error: the booking still stands, and the patient gets
 * their link from the manage page or from the provider. Better a confirmation with no button
 * than no confirmation at all.
 *
 * The wording about the link opening 15 minutes early matters: the URL is live from the moment
 * it is sent, but the room is not, and a patient who clicks the day before should understand
 * they haven't done anything wrong.
 */
function renderVideoJoinBlock(joinUrl?: string | null, doxyRoomUrl?: string | null): string {
  const url = joinUrl || doxyRoomUrl;
  if (!url) return "";

  // The two are not interchangeable and the instructions must not be. A per-visit link opens
  // straight into that patient's own room; a Doxy room is shared and permanent, so the patient
  // types their name and waits to be let in. Telling someone with a waiting-room link that it
  // "becomes active 15 minutes before" would have them refreshing an already-working page, and
  // "personal to you — don't forward it" is simply false of a room the whole practice shares.
  const isWaitingRoom = !joinUrl && !!doxyRoomUrl;

  return `
        <p style="margin-top:20px">
          <a href="${url}"
             style="background:#047857;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            ${isWaitingRoom ? "Open the video waiting room" : "Join your video appointment"}
          </a>
        </p>
        <p style="margin-top:8px;font-size:13px;color:#555">
          ${
            isWaitingRoom
              ? `Open this link at your appointment time, enter your name, and wait — your
                 physician will let you in. You'll need a device with a camera and microphone;
                 no app or account is needed.`
              : `The link becomes active 15 minutes before your scheduled time. You'll need a
                 device with a camera and microphone. This link is personal to you — please
                 don't forward it.`
          }
        </p>`;
}

/**
 * Renders the appointment format (phone / video / in-person) as a table row, so
 * the patient knows from the confirmation alone what to expect at that time.
 */
function renderModalityRow(modality: AppointmentModality): string {
  return `
          <tr><td style="padding:8px 0;color:#555">Format</td>
              <td style="padding:8px 0;font-weight:600">${MODALITY_LABEL[modality]}</td></tr>`;
}

function formatDateTime(isoString: string, timezone = "America/Vancouver"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

export async function sendBookingConfirmation(opts: {
  email: string;
  patientFirstName: string;
  clinicName: string;
  slotStartTime: string;
  slotEndTime: string;
  timezone: string;
  manageUrl: string;
  emailFooter?: string | null;
  clinicEmail?: string | null;
  appointmentModality?: AppointmentModality | null;
  /** Present only for a video visit whose room was created at booking time. */
  videoJoinUrl?: string | null;
  /** The provider's permanent Doxy waiting room, used when there is no per-visit link. */
  doxyRoomUrl?: string | null;
}): Promise<void> {
  if (!resend || process.env.HIPAA_MODE === "true") return;

  const dateLabel = formatDateTime(opts.slotStartTime, opts.timezone);
  const sender = resolveSender(opts.clinicName, opts.clinicEmail);
  const modality = normalizeModality(opts.appointmentModality);

  await resend.emails.send({
    from: sender.from,
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
    to: opts.email,
    subject: `Appointment Confirmed — ${opts.clinicName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1a1a2e">Your ${MODALITY_LABEL[modality].toLowerCase()} is confirmed</h2>
        <p>Hi ${opts.patientFirstName},</p>
        <p>Your appointment has been booked successfully.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:8px 0;color:#555;width:140px">Clinic</td>
              <td style="padding:8px 0;font-weight:600">${opts.clinicName}</td></tr>
          <tr><td style="padding:8px 0;color:#555">Date &amp; time</td>
              <td style="padding:8px 0;font-weight:600">${dateLabel}</td></tr>${renderModalityRow(modality)}
        </table>
        <div style="background:#eff6ff;border-left:4px solid #2563eb;border-radius:6px;padding:12px 16px">
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#1e40af">${MODALITY_LABEL[modality]}</p>
          <p style="margin:0;color:#1e3a5f;line-height:1.5">${MODALITY_NOTE[modality]}</p>
        </div>${renderVideoJoinBlock(opts.videoJoinUrl, opts.doxyRoomUrl)}
        <p style="margin-top:24px">
          <a href="${opts.manageUrl}"
             style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            View or Cancel Appointment
          </a>
        </p>
        <p style="margin-top:24px;font-size:13px;color:#888">
          This link is valid for 30 days. If you need to cancel, please do so as soon as possible
          so the time slot can be made available to other patients.
        </p>${renderFooter(opts.emailFooter)}
      </div>`,
  });
}

export async function sendDocumentRequestEmail(opts: {
  email: string;
  patientName: string;
  clinicName: string;
  uploadUrl: string;
  expiresAt: Date;
  requestNote?: string | null;
  emailFooter?: string | null;
  clinicEmail?: string | null;
}): Promise<{ sent: boolean; error?: string }> {
  if (!resend || process.env.HIPAA_MODE === "true") {
    return { sent: false, error: "email_suppressed" };
  }

  const sender = resolveSender(opts.clinicName, opts.clinicEmail);
  const firstName = (opts.patientName || "").trim().split(/\s+/)[0] || "there";
  const expiryLabel = formatDateTime(opts.expiresAt.toISOString());

  // What the clinic actually asked for, when they specified it. Author-supplied
  // free text, so escape it — the rest of this template interpolates raw.
  const note = (opts.requestNote ?? "").trim();
  const noteBlock = note
    ? `
        <div style="margin-top:20px;background:#eff6ff;border-left:4px solid #2563eb;border-radius:6px;padding:12px 16px">
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#1e40af">What we need</p>
          <p style="margin:0;color:#1e3a5f;line-height:1.5">${escapeHtml(note)}</p>
        </div>`
    : "";

  const result = await resend.emails.send({
    from: sender.from,
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
    to: opts.email,
    subject: `Document upload request — ${opts.clinicName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1a1a2e">Please upload your documents (optional)</h2>
        <p>Hi ${firstName},</p>
        <p>${opts.clinicName} has requested that you securely upload up to 3
           documents (for example a photo of your ID, or images and PDFs of your
           records). Your files are sent directly to the clinic and are not stored
           on your device.</p>${noteBlock}
        <p style="margin-top:20px;font-size:13px;color:#666;line-height:1.5">
          This is optional — if you don't have these on hand right now, you can
          upload them later using the link below, any time before it expires.
        </p>
        <p style="margin-top:24px">
          <a href="${opts.uploadUrl}"
             style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            Upload documents
          </a>
        </p>
        <p style="margin-top:24px;font-size:13px;color:#888">
          This secure link expires on ${expiryLabel}. If it has expired, please
          contact the clinic for a new one. Do not share this link with anyone.
        </p>${renderFooter(opts.emailFooter)}
      </div>`,
  });

  if (result.error) {
    console.error("[booking-email] sendDocumentRequestEmail Resend error:", result.error);
    return { sent: false, error: "send_failed" };
  }
  return { sent: true };
}

export async function sendDocumentShareEmail(opts: {
  email: string;
  recipientName?: string | null;
  clinicName: string;
  downloadUrl: string;
  expiresAt: Date;
  emailFooter?: string | null;
  clinicEmail?: string | null;
}): Promise<{ sent: boolean; error?: string }> {
  if (!resend || process.env.HIPAA_MODE === "true") {
    return { sent: false, error: "email_suppressed" };
  }

  const sender = resolveSender(opts.clinicName, opts.clinicEmail);
  const firstName = (opts.recipientName || "").trim().split(/\s+/)[0] || "there";
  const expiryLabel = formatDateTime(opts.expiresAt.toISOString());

  const result = await resend.emails.send({
    from: sender.from,
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
    to: opts.email,
    subject: `Secure files from ${opts.clinicName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1a1a2e">You have secure files to download</h2>
        <p>Hi ${firstName},</p>
        <p>${opts.clinicName} has sent you one or more files through a secure,
           password-protected link.</p>
        <p style="margin-top:24px">
          <a href="${opts.downloadUrl}"
             style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            Open secure files
          </a>
        </p>
        <p style="margin-top:24px;font-size:13px;color:#555">
          You will need the <strong>passphrase</strong> to open these files. For your
          security it is <strong>not</strong> included in this email — ${opts.clinicName}
          will share it with you separately (for example by phone).
        </p>
        <p style="margin-top:12px;font-size:13px;color:#888">
          This secure link expires on ${expiryLabel}. Please do not forward it.
        </p>${renderFooter(opts.emailFooter)}
      </div>`,
  });

  if (result.error) {
    console.error("[booking-email] sendDocumentShareEmail Resend error:", result.error);
    return { sent: false, error: "send_failed" };
  }
  return { sent: true };
}

export async function sendCancellationConfirmation(opts: {
  email: string;
  patientFirstName: string;
  clinicName: string;
  slotStartTime: string;
  timezone: string;
  emailFooter?: string | null;
  clinicEmail?: string | null;
}): Promise<void> {
  if (!resend || process.env.HIPAA_MODE === "true") return;

  const dateLabel = formatDateTime(opts.slotStartTime, opts.timezone);
  const sender = resolveSender(opts.clinicName, opts.clinicEmail);

  await resend.emails.send({
    from: sender.from,
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
    to: opts.email,
    subject: `Appointment Cancelled — ${opts.clinicName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1a1a2e">Appointment Cancelled</h2>
        <p>Hi ${opts.patientFirstName},</p>
        <p>Your appointment has been cancelled.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:8px 0;color:#555;width:140px">Clinic</td>
              <td style="padding:8px 0;font-weight:600">${opts.clinicName}</td></tr>
          <tr><td style="padding:8px 0;color:#555">Was scheduled for</td>
              <td style="padding:8px 0;font-weight:600">${dateLabel}</td></tr>
        </table>
        <p style="font-size:13px;color:#888">
          If you did not request this cancellation, please contact the clinic directly.
        </p>${renderFooter(opts.emailFooter)}
      </div>`,
  });
}

/**
 * Email a patient the link to their video visit, on demand from the provider console.
 *
 * Distinguishes "suppressed" from "sent" for the same reason the SMS twin does: a provider is
 * standing there watching for confirmation, so a silent no-op under HIPAA_MODE would leave them
 * believing a patient had been contacted who hadn't.
 *
 * Deliberately thin on content — clinic name, time, and the link. No reason for visit, no
 * physician note, nothing that turns a mail server into a place PHI accumulates.
 */
export async function sendVideoVisitLinkEmail(opts: {
  email: string;
  patientFirstName?: string | null;
  clinicName: string;
  joinUrl: string;
  slotStartTime?: string | null;
  timezone?: string;
  emailFooter?: string | null;
  clinicEmail?: string | null;
}): Promise<{ sent: boolean; suppressed?: boolean; error?: string }> {
  if (!resend || process.env.HIPAA_MODE === "true") {
    return { sent: false, suppressed: true, error: "email_suppressed" };
  }

  const sender = resolveSender(opts.clinicName, opts.clinicEmail);
  const greeting = (opts.patientFirstName || "").trim() || "there";
  const dateLabel = opts.slotStartTime
    ? formatDateTime(opts.slotStartTime, opts.timezone ?? "America/Vancouver")
    : null;

  const result = await resend.emails.send({
    from: sender.from,
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
    to: opts.email,
    subject: `Your video appointment — ${opts.clinicName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1a1a2e">Your video appointment</h2>
        <p>Hi ${greeting},</p>
        <p>
          ${escapeHtml(opts.clinicName)}
          has sent you a link to join your appointment by video${dateLabel ? ` on ${dateLabel}` : ""}.
        </p>
        <p style="margin:28px 0">
          <a href="${opts.joinUrl}"
             style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Join video appointment
          </a>
        </p>
        <p style="color:#475569;font-size:14px">
          The link becomes active 15 minutes before your scheduled time. You'll need a device
          with a camera and microphone — if the video doesn't start, open the link in Safari or
          Chrome rather than inside another app.
        </p>
        <p style="color:#94a3b8;font-size:12px">
          This link is personal to you. Please don't forward it.
        </p>${renderFooter(opts.emailFooter)}
      </div>`,
  });

  if (result.error) {
    console.error("[booking-email] sendVideoVisitLinkEmail Resend error:", result.error);
    return { sent: false, error: "send_failed" };
  }
  return { sent: true };
}
