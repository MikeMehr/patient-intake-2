import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
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
}): Promise<void> {
  if (!resend || process.env.HIPAA_MODE === "true") return;

  const dateLabel = formatDateTime(opts.slotStartTime, opts.timezone);

  await resend.emails.send({
    from: getFromEmail(),
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
        </p>
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
}): Promise<void> {
  if (!resend || process.env.HIPAA_MODE === "true") return;

  const dateLabel = formatDateTime(opts.slotStartTime, opts.timezone);

  await resend.emails.send({
    from: getFromEmail(),
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
        </p>
      </div>`,
  });
}
