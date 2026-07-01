import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
}

/**
 * Builds the "from" header. When the clinic has a configured email, send from
 * that address (with the clinic name as the display name) so patients see the
 * clinic as the sender — e.g. `MyMD Telehealth <info@mymdonline.ca>`. Falls
 * back to the platform's verified sender when no clinic email is set.
 *
 * Note: the clinic email's domain must be verified in Resend, otherwise Resend
 * rejects the send.
 */
function buildFrom(clinicName?: string | null, clinicEmail?: string | null): string {
  const addr = (clinicEmail ?? "").trim();
  if (!addr) return getFromEmail();
  const name = (clinicName ?? "").trim().replace(/["\\<>]/g, "");
  return name ? `${name} <${addr}>` : addr;
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
  physicianName: string;
  slotStartTime: string;
  slotEndTime: string;
  timezone: string;
  manageUrl: string;
  emailFooter?: string | null;
  clinicEmail?: string | null;
}): Promise<void> {
  if (!resend || process.env.HIPAA_MODE === "true") return;

  const dateLabel = formatDateTime(opts.slotStartTime, opts.timezone);

  await resend.emails.send({
    from: buildFrom(opts.clinicName, opts.clinicEmail),
    to: opts.email,
    subject: `Appointment Confirmed — ${opts.clinicName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1a1a2e">Your appointment is confirmed</h2>
        <p>Hi ${opts.patientFirstName},</p>
        <p>Your appointment has been booked successfully.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr><td style="padding:8px 0;color:#555;width:140px">Clinic</td>
              <td style="padding:8px 0;font-weight:600">${opts.clinicName}</td></tr>
          <tr><td style="padding:8px 0;color:#555">Physician</td>
              <td style="padding:8px 0;font-weight:600">${opts.physicianName}</td></tr>
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

export async function sendCancellationConfirmation(opts: {
  email: string;
  patientFirstName: string;
  clinicName: string;
  physicianName: string;
  slotStartTime: string;
  timezone: string;
  emailFooter?: string | null;
  clinicEmail?: string | null;
}): Promise<void> {
  if (!resend || process.env.HIPAA_MODE === "true") return;

  const dateLabel = formatDateTime(opts.slotStartTime, opts.timezone);

  await resend.emails.send({
    from: buildFrom(opts.clinicName, opts.clinicEmail),
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
          <tr><td style="padding:8px 0;color:#555">Physician</td>
              <td style="padding:8px 0;font-weight:600">${opts.physicianName}</td></tr>
          <tr><td style="padding:8px 0;color:#555">Was scheduled for</td>
              <td style="padding:8px 0;font-weight:600">${dateLabel}</td></tr>
        </table>
        <p style="font-size:13px;color:#888">
          If you did not request this cancellation, please contact the clinic directly.
        </p>${renderFooter(opts.emailFooter)}
      </div>`,
  });
}
