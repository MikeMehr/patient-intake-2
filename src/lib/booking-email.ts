import { Resend } from "resend";

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
 * Renders the clinic's configured plain-text email footer as a safe HTML block.
 * Escapes HTML and preserves the author's line breaks. Returns "" when no footer
 * is configured so callers can concatenate unconditionally.
 */
function renderFooter(footer?: string | null): string {
  const text = (footer ?? "").trim();
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return `
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
        <div style="font-size:12px;color:#888;line-height:1.5">${escaped}</div>`;
}

/**
 * Renders the Physician table row, or "" when no name could be resolved — the
 * row is dropped entirely rather than left with an empty value beside the label.
 */
function renderPhysicianRow(physicianName?: string | null): string {
  const name = (physicianName ?? "").trim();
  if (!name) return "";
  return `
          <tr><td style="padding:8px 0;color:#555">Physician</td>
              <td style="padding:8px 0;font-weight:600">${name}</td></tr>`;
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
  physicianName?: string | null;
  slotStartTime: string;
  slotEndTime: string;
  timezone: string;
  manageUrl: string;
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
    subject: `Appointment Confirmed — ${opts.clinicName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1a1a2e">Your appointment is confirmed</h2>
        <p>Hi ${opts.patientFirstName},</p>
        <p>Your appointment has been booked successfully.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:8px 0;color:#555;width:140px">Clinic</td>
              <td style="padding:8px 0;font-weight:600">${opts.clinicName}</td></tr>${renderPhysicianRow(opts.physicianName)}
          <tr><td style="padding:8px 0;color:#555">Date &amp; time</td>
              <td style="padding:8px 0;font-weight:600">${dateLabel}</td></tr>
        </table>
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
  emailFooter?: string | null;
  clinicEmail?: string | null;
}): Promise<{ sent: boolean; error?: string }> {
  if (!resend || process.env.HIPAA_MODE === "true") {
    return { sent: false, error: "email_suppressed" };
  }

  const sender = resolveSender(opts.clinicName, opts.clinicEmail);
  const firstName = (opts.patientName || "").trim().split(/\s+/)[0] || "there";
  const expiryLabel = formatDateTime(opts.expiresAt.toISOString());

  const result = await resend.emails.send({
    from: sender.from,
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
    to: opts.email,
    subject: `Document upload request — ${opts.clinicName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1a1a2e">Please upload your documents</h2>
        <p>Hi ${firstName},</p>
        <p>${opts.clinicName} has requested that you securely upload one or more
           documents (for example a photo of your ID, or images and PDFs of your
           records). Your files are sent directly to the clinic and are not stored
           on your device.</p>
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

export async function sendCancellationConfirmation(opts: {
  email: string;
  patientFirstName: string;
  clinicName: string;
  physicianName?: string | null;
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
              <td style="padding:8px 0;font-weight:600">${opts.clinicName}</td></tr>${renderPhysicianRow(opts.physicianName)}
          <tr><td style="padding:8px 0;color:#555">Was scheduled for</td>
              <td style="padding:8px 0;font-weight:600">${dateLabel}</td></tr>
        </table>
        <p style="font-size:13px;color:#888">
          If you did not request this cancellation, please contact the clinic directly.
        </p>${renderFooter(opts.emailFooter)}
      </div>`,
  });
}
