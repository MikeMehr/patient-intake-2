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

    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: physicianPhone,
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
