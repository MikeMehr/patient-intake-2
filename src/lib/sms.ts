import { Twilio } from "twilio";
import { logDebug } from "./secure-logger";

let twilioClient: Twilio | null = null;

function getTwilioClient(): Twilio {
  if (twilioClient) return twilioClient;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error(
      "Twilio credentials not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables."
    );
  }

  twilioClient = new Twilio(accountSid, authToken);
  return twilioClient;
}

export interface SendSmsResult {
  success: boolean;
  messageSid?: string;
  error?: string;
}

/**
 * Send an emergency alert SMS to a physician
 * @param physicianPhone - The physician's phone number (E.164 format recommended, e.g., +1234567890)
 * @param patientName - The patient's name to include in alert
 * @param patientRecordUrl - URL to the patient's record in the dashboard
 * @returns Result object with success status and message SID or error
 */
/** Normalize a North American phone number to E.164 format (+1XXXXXXXXXX) */
export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone; // return as-is if unrecognized format
}

export async function sendEmergencyAlertSMS(
  physicianPhone: string,
  patientName: string,
  patientRecordUrl: string
): Promise<SendSmsResult> {
  // Respect HIPAA mode - don't send external SMS if disabled
  if (process.env.HIPAA_MODE === "true") {
    logDebug("[sms] HIPAA_MODE enabled - SMS sending disabled", {
      physicianPhone: "***",
      patientName,
    });
    return {
      success: true,
      error: "SMS disabled in HIPAA mode",
    };
  }

  try {
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
      throw new Error(
        "TWILIO_PHONE_NUMBER environment variable not configured"
      );
    }

    const client = getTwilioClient();

    // Construct emergency alert message
    const message = `ALERT: Emergency case detected for ${patientName}. Review at ${patientRecordUrl}`;

    logDebug("[sms] Sending emergency alert SMS", {
      to: "***",
      patientName,
      messageLength: message.length,
    });

    const toNumber = toE164(physicianPhone);
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: toNumber,
    });

    logDebug("[sms] SMS sent successfully", {
      messageSid: result.sid,
      status: result.status,
    });

    return {
      success: true,
      messageSid: result.sid,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logDebug("[sms] Failed to send SMS", {
      error: errorMessage,
      patientName,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Notify a physician by SMS that a patient has booked an appointment online.
 * Best-effort — the booking is already committed before this is called.
 * @param physicianPhone - The physician's phone number (any North American format; normalized to E.164)
 * @param details - Booking details to include in the message
 * @returns Result object with success status and message SID or error
 */
export async function sendBookingAlertSMS(
  physicianPhone: string,
  details: {
    patientName: string;
    clinicName: string;
    dateLabel: string;
    manageUrl?: string;
  }
): Promise<SendSmsResult> {
  // Respect HIPAA mode - don't send external SMS if disabled (message contains patient name)
  if (process.env.HIPAA_MODE === "true") {
    logDebug("[sms] HIPAA_MODE enabled - booking alert SMS disabled", {
      physicianPhone: "***",
    });
    return {
      success: true,
      error: "SMS disabled in HIPAA mode",
    };
  }

  try {
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
      throw new Error(
        "TWILIO_PHONE_NUMBER environment variable not configured"
      );
    }

    const client = getTwilioClient();

    let message = `New appointment: ${details.patientName} booked ${details.dateLabel} at ${details.clinicName}.`;
    if (details.manageUrl) {
      message += ` Details: ${details.manageUrl}`;
    }

    logDebug("[sms] Sending booking alert SMS", {
      to: "***",
      messageLength: message.length,
    });

    const toNumber = toE164(physicianPhone);
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: toNumber,
    });

    logDebug("[sms] Booking alert SMS sent successfully", {
      messageSid: result.sid,
      status: result.status,
    });

    return {
      success: true,
      messageSid: result.sid,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logDebug("[sms] Failed to send booking alert SMS", {
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Notify a physician by SMS that a patient has completed the guided interview,
 * so they can review the intake and call the patient back.
 * Best-effort — the session is already saved before this is called.
 * @param physicianPhone - The physician's phone number (any North American format; normalized to E.164)
 * @param details - Completion details to include in the message
 * @returns Result object with success status and message SID or error
 */
export async function sendInterviewCompleteSMS(
  physicianPhone: string,
  details: {
    patientName: string;
    reviewUrl?: string;
  }
): Promise<SendSmsResult> {
  // Respect HIPAA mode - don't send external SMS if disabled (message contains patient name)
  if (process.env.HIPAA_MODE === "true") {
    logDebug("[sms] HIPAA_MODE enabled - interview complete SMS disabled", {
      physicianPhone: "***",
    });
    return {
      success: true,
      error: "SMS disabled in HIPAA mode",
    };
  }

  try {
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
      throw new Error(
        "TWILIO_PHONE_NUMBER environment variable not configured"
      );
    }

    const client = getTwilioClient();

    let message = `Interview complete: ${details.patientName} finished their guided interview and is ready for a call back.`;
    if (details.reviewUrl) {
      message += ` Review: ${details.reviewUrl}`;
    }

    logDebug("[sms] Sending interview complete SMS", {
      to: "***",
      messageLength: message.length,
    });

    const toNumber = toE164(physicianPhone);
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: toNumber,
    });

    logDebug("[sms] Interview complete SMS sent successfully", {
      messageSid: result.sid,
      status: result.status,
    });

    return {
      success: true,
      messageSid: result.sid,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logDebug("[sms] Failed to send interview complete SMS", {
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Text a caller the online booking link after they phone the clinic.
 * Best-effort — the call is already being handled when this is invoked.
 *
 * The message deliberately carries no PHI: clinic name, booking link, opt-out.
 * @param callerPhone - The caller's number as reported by Twilio (E.164 already, but normalized defensively)
 * @param details - Clinic name and the public booking URL to send
 * @returns Result object with success status and message SID or error
 */
export async function sendBookingLinkSMS(
  callerPhone: string,
  details: {
    clinicName: string;
    bookingUrl: string;
  }
): Promise<SendSmsResult> {
  // Respect HIPAA mode - the whole call-deflection flow routes calls through
  // Twilio, so if external SMS is off this feature is off too.
  if (process.env.HIPAA_MODE === "true") {
    logDebug("[sms] HIPAA_MODE enabled - booking link SMS disabled", {
      callerPhone: "***",
    });
    return {
      success: true,
      error: "SMS disabled in HIPAA mode",
    };
  }

  try {
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
      throw new Error(
        "TWILIO_PHONE_NUMBER environment variable not configured"
      );
    }

    const client = getTwilioClient();

    const message =
      `${details.clinicName}: book your appointment online here — ${details.bookingUrl}` +
      ` It's the fastest way to see all open times. Reply STOP to opt out.`;

    logDebug("[sms] Sending booking link SMS", {
      to: "***",
      messageLength: message.length,
    });

    const toNumber = toE164(callerPhone);
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: toNumber,
    });

    logDebug("[sms] Booking link SMS sent successfully", {
      messageSid: result.sid,
      status: result.status,
    });

    return {
      success: true,
      messageSid: result.sid,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logDebug("[sms] Failed to send booking link SMS", {
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Tell the clinic they missed a call, so they can ring the patient back.
 * Best-effort — the caller has already been handled when this is invoked.
 *
 * Deflection routes unanswered calls to Twilio, which displaces the carrier
 * voicemail, so this is the clinic's only record that the call happened.
 * @param clinicPhone - Where to send the alert (usually the clinic's own number)
 * @param details - Who called, and whether they were sent the booking link
 * @returns Result object with success status and message SID or error
 */
export async function sendMissedCallSMS(
  clinicPhone: string,
  details: {
    callerNumber: string;
    linkTexted: boolean;
  }
): Promise<SendSmsResult> {
  // Respect HIPAA mode - don't send external SMS if disabled
  if (process.env.HIPAA_MODE === "true") {
    logDebug("[sms] HIPAA_MODE enabled - missed call SMS disabled", {
      clinicPhone: "***",
    });
    return {
      success: true,
      error: "SMS disabled in HIPAA mode",
    };
  }

  try {
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
      throw new Error(
        "TWILIO_PHONE_NUMBER environment variable not configured"
      );
    }

    const client = getTwilioClient();

    const message = details.linkTexted
      ? `Missed call from ${details.callerNumber}. They were texted your online booking link.`
      : `Missed call from ${details.callerNumber}. No booking link sent — they may be on a landline.`;

    logDebug("[sms] Sending missed call SMS", {
      to: "***",
      linkTexted: details.linkTexted,
    });

    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: toE164(clinicPhone),
    });

    logDebug("[sms] Missed call SMS sent successfully", {
      messageSid: result.sid,
      status: result.status,
    });

    return {
      success: true,
      messageSid: result.sid,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logDebug("[sms] Failed to send missed call SMS", {
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Send a one-time verification code (2FA) to a patient via SMS.
 * Used by the guided-interview invitation flow in place of email OTP.
 * @param patientPhone - The patient's phone number (any North American format; normalized to E.164)
 * @param code - The 6-digit one-time code
 * @param clinicName - Clinic name shown in the message for context
 * @returns Result object with success status and message SID or error
 */
export async function sendVerificationSMS(
  patientPhone: string,
  code: string,
  clinicName: string
): Promise<SendSmsResult> {
  // Respect HIPAA mode - don't send external SMS if disabled
  if (process.env.HIPAA_MODE === "true") {
    logDebug("[sms] HIPAA_MODE enabled - verification SMS disabled", {
      patientPhone: "***",
    });
    return {
      success: true,
      error: "SMS disabled in HIPAA mode",
    };
  }

  try {
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
      throw new Error(
        "TWILIO_PHONE_NUMBER environment variable not configured"
      );
    }

    const client = getTwilioClient();

    const message = `${clinicName}: Your intake verification code is ${code}. It expires in 10 minutes.`;

    logDebug("[sms] Sending verification SMS", {
      to: "***",
      messageLength: message.length,
    });

    const toNumber = toE164(patientPhone);
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: toNumber,
    });

    logDebug("[sms] Verification SMS sent successfully", {
      messageSid: result.sid,
      status: result.status,
    });

    return {
      success: true,
      messageSid: result.sid,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logDebug("[sms] Failed to send verification SMS", {
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}
