/**
 * POST /api/voice/incoming
 *
 * Twilio voice webhook for call deflection. The clinic's published number is a
 * mobile, so calls it doesn't answer are forwarded here on busy/no-answer. We
 * text the caller the online booking link and tell the clinic they missed a
 * call, since forwarding displaces the carrier voicemail.
 *
 * Public by design (Twilio is the caller), so every request is authenticated by
 * its X-Twilio-Signature. Without that check this endpoint is an open
 * SMS-sending oracle.
 *
 * If CLINIC_FORWARD_TO_NUMBER is set we instead connect the call onward after
 * texting. That only makes sense when the published number differs from the
 * handset that answers, otherwise the call forwards straight back here.
 */

import { NextRequest } from "next/server";
import { validateRequest } from "twilio";
import { getClinicBySlug } from "@/lib/booking-store";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { sendBookingLinkSMS, sendMissedCallSMS, toE164 } from "@/lib/sms";
import { logDebug } from "@/lib/secure-logger";

/** Don't re-text a caller who rings back within this window. */
const DEDUPE_WINDOW_SECONDS = 6 * 60 * 60;

/**
 * Operational failures have to be visible in production, where logDebug is
 * gated off to protect PHI. This feature's whole job is to not silently lose a
 * patient's call, so a silent failure is the worst outcome.
 *
 * Never pass the caller's number or any patient data — error text and Twilio
 * status codes only.
 */
function logFailure(message: string, meta?: Record<string, unknown>): void {
  console.error(`[voice] ${message}`, meta ?? "");
}

/**
 * Twilio's legacy "alice" voice sounds robotic. Neural Polly is far more
 * natural. Overridable without a deploy — see Twilio's <Say> voice list.
 */
const VOICE = process.env.CALL_DEFLECT_VOICE ?? "Polly.Joanna-Neural";

/**
 * Callers reach a recording rather than a person, so point emergencies at 911
 * first — someone in distress may hang up before the rest plays.
 * Spaced digits stop the voice reading "nine hundred eleven".
 */
const EMERGENCY_NOTICE = "If this is a medical emergency, hang up and dial 9 1 1.";

/**
 * How the clinic's name should be *pronounced*, which is not always how it is
 * spelled: text-to-speech reads "MyMD" as one mangled word, so the spoken name
 * is "My MD Telehealth". Falls back to the name on record. Speech only — SMS
 * keeps the real spelling.
 */
function spokenClinicName(nameOnRecord: string): string {
  return process.env.CALL_DEFLECT_SPOKEN_CLINIC_NAME ?? nameOnRecord;
}

/**
 * The contact address as it should be *said*, letters spaced so the voice reads
 * "info at my em dee online dot see ay" instead of mangling it into one word.
 * The domain is .ca — mymdonline.com has no MX record and mail to it bounces.
 */
const SPOKEN_EMAIL =
  process.env.CALL_DEFLECT_SPOKEN_EMAIL ?? "info at my M D online dot C A";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function say(text: string): string {
  return `<Say voice="${escapeXml(VOICE)}">${escapeXml(text)}</Say>`;
}

function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

/**
 * Rebuild the URL Twilio signed. Azure terminates TLS upstream, so req.url can
 * arrive as http://<internal-host> and would not match Twilio's signature.
 */
function publicUrl(req: NextRequest): string {
  const configured = process.env.TWILIO_WEBHOOK_BASE_URL;
  if (configured) {
    return `${configured.replace(/\/$/, "")}/api/voice/incoming`;
  }
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `${proto}://${host}/api/voice/incoming`;
}

/** What the caller hears. `linkTexted` is false for landlines and withheld numbers. */
function buildResponse(opts: {
  forwardTo?: string;
  clinicName?: string;
  linkTexted: boolean;
}): Response {
  const greeting = opts.clinicName
    ? `Thank you for calling ${opts.clinicName}.`
    : "Thank you for calling.";

  if (opts.forwardTo) {
    const spoken = opts.linkTexted
      ? `${greeting} We've just texted you a link to book online, which is the fastest way to see all open appointment times. Stay on the line to speak with us.`
      : `${greeting} Please stay on the line.`;
    return twiml(
      say(spoken) +
        `<Dial timeout="25" callerId="${escapeXml(process.env.TWILIO_PHONE_NUMBER ?? "")}">` +
        `${escapeXml(toE164(opts.forwardTo))}</Dial>`,
    );
  }

  // Keep this short. It is synthetic speech and the caller wants their time back;
  // the detail belongs in the text message, which they can read at their own pace.
  // No link reached this caller (landline, withheld number, or they rang back
  // inside the dedupe window), so give them a channel they can actually use
  // rather than promising a call back.
  const spoken = opts.linkTexted
    ? `${greeting} Sorry we missed you. We've just texted you a link to book online. Goodbye.`
    : `${greeting} Sorry we missed you. Please email your questions to ${SPOKEN_EMAIL}. Thank you.`;

  return twiml(say(EMERGENCY_NOTICE) + say(spoken) + `<Hangup/>`);
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers.get("x-twilio-signature");

  if (!authToken) {
    logFailure("TWILIO_AUTH_TOKEN not configured - rejecting webhook");
    return new Response("Not configured", { status: 503 });
  }

  const raw = await req.text();
  const params: Record<string, string> = {};
  new URLSearchParams(raw).forEach((value, key) => {
    params[key] = value;
  });

  if (!signature || !validateRequest(authToken, signature, publicUrl(req), params)) {
    logFailure("Rejected webhook with invalid Twilio signature");
    return new Response("Forbidden", { status: 403 });
  }

  const forwardTo = process.env.CLINIC_FORWARD_TO_NUMBER;
  const clinicSlug = process.env.CALL_DEFLECT_CLINIC_SLUG;
  const from = params.From?.trim();

  // Everything below is best-effort: a failure here must still answer the call.
  try {
    const clinic = clinicSlug ? await getClinicBySlug(clinicSlug) : null;

    if (!clinic) {
      logFailure("No clinic resolved - answering without SMS", { clinicSlug });
      return buildResponse({ forwardTo, linkTexted: false });
    }

    // Only E.164 numbers can be texted back. Withheld caller ID arrives as
    // "anonymous"/"unknown", which this also excludes.
    const textable = Boolean(from) && from!.startsWith("+");

    let linkTexted = false;
    if (textable && clinic.settings?.onlineBookingEnabled) {
      const dedupe = await consumeDbRateLimit({
        bucketKey: `voice-deflect:${from}`,
        maxAttempts: 1,
        windowSeconds: DEDUPE_WINDOW_SECONDS,
      });

      if (dedupe.allowed) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://mymd.health-assist.org";
        const result = await sendBookingLinkSMS(from!, {
          clinicName: clinic.name,
          bookingUrl: `${appUrl}/booking/${clinic.slug}`,
        });
        linkTexted = result.success;
        if (!result.success) {
          logFailure("Booking link SMS failed", { error: result.error });
        }
      } else {
        logDebug("[voice] Caller already texted recently - skipping booking link");
      }
    }

    // Deflection displaces the carrier voicemail, so the clinic would otherwise
    // have no record of this call. Not deduped: every missed call should surface.
    const notifyNumber = process.env.CALL_DEFLECT_NOTIFY_NUMBER ?? clinic.phone;
    if (!forwardTo && notifyNumber) {
      const notified = await sendMissedCallSMS(notifyNumber, {
        callerNumber: from || "a withheld number",
        linkTexted,
      });
      if (!notified.success) {
        logFailure("Missed call notification failed", { error: notified.error });
      }
    }

    return buildResponse({
      forwardTo,
      clinicName: spokenClinicName(clinic.name),
      linkTexted,
    });
  } catch (error) {
    // Never let an internal error drop a patient's call.
    logFailure("Unexpected error - answering anyway", {
      error: error instanceof Error ? error.message : String(error),
    });
    return buildResponse({ forwardTo, linkTexted: false });
  }
}
