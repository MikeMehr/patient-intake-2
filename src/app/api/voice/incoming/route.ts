/**
 * POST /api/voice/incoming
 *
 * Twilio voice webhook for call deflection. When a patient phones the clinic
 * and the carrier forwards the call here, we text them the online booking link
 * and then connect the call through to the clinic as normal.
 *
 * Public by design (Twilio is the caller), so every request is authenticated by
 * its X-Twilio-Signature. Without that check this endpoint is an open
 * SMS-sending oracle.
 */

import { NextRequest } from "next/server";
import { validateRequest } from "twilio";
import { getClinicBySlug } from "@/lib/booking-store";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { sendBookingLinkSMS, toE164 } from "@/lib/sms";
import { logDebug } from "@/lib/secure-logger";

/** Don't re-text a caller who rings back within this window. */
const DEDUPE_WINDOW_SECONDS = 6 * 60 * 60;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

/** Connect the caller onward to the clinic, or apologise if we can't. */
function connectOrClose(forwardTo: string | undefined, spoken: string): Response {
  if (!forwardTo) {
    return twiml(
      `<Say voice="alice">${escapeXml(spoken)}</Say>` +
        `<Say voice="alice">Please call back during office hours, or book online using the link we sent. Goodbye.</Say>` +
        `<Hangup/>`,
    );
  }
  return twiml(
    `<Say voice="alice">${escapeXml(spoken)}</Say>` +
      `<Dial timeout="25" callerId="${escapeXml(process.env.TWILIO_PHONE_NUMBER ?? "")}">` +
      `${escapeXml(toE164(forwardTo))}</Dial>`,
  );
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers.get("x-twilio-signature");

  if (!authToken) {
    logDebug("[voice] TWILIO_AUTH_TOKEN not configured - rejecting webhook");
    return new Response("Not configured", { status: 503 });
  }

  const raw = await req.text();
  const params: Record<string, string> = {};
  new URLSearchParams(raw).forEach((value, key) => {
    params[key] = value;
  });

  if (!signature || !validateRequest(authToken, signature, publicUrl(req), params)) {
    logDebug("[voice] Rejected webhook with invalid Twilio signature");
    return new Response("Forbidden", { status: 403 });
  }

  const forwardTo = process.env.CLINIC_FORWARD_TO_NUMBER;
  const clinicSlug = process.env.CALL_DEFLECT_CLINIC_SLUG;
  const from = params.From?.trim();

  // Everything below is best-effort: a failure here must still connect the call.
  let spoken = "Thank you for calling.";
  try {
    const clinic = clinicSlug ? await getClinicBySlug(clinicSlug) : null;

    if (!clinic) {
      logDebug("[voice] No clinic resolved - connecting call without SMS", { clinicSlug });
      return connectOrClose(forwardTo, spoken);
    }

    spoken = `Thank you for calling ${clinic.name}.`;

    // Blocked/withheld caller ID, or a call from a non-textable source.
    if (!from || from.toLowerCase() === "anonymous" || !from.startsWith("+")) {
      logDebug("[voice] No usable caller ID - connecting call without SMS");
      return connectOrClose(forwardTo, spoken);
    }

    if (!clinic.settings?.onlineBookingEnabled) {
      logDebug("[voice] Online booking disabled for clinic - connecting call without SMS");
      return connectOrClose(forwardTo, spoken);
    }

    const dedupe = await consumeDbRateLimit({
      bucketKey: `voice-deflect:${from}`,
      maxAttempts: 1,
      windowSeconds: DEDUPE_WINDOW_SECONDS,
    });

    if (!dedupe.allowed) {
      logDebug("[voice] Caller already texted recently - skipping SMS");
      return connectOrClose(forwardTo, spoken);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://mymd.health-assist.org";
    const result = await sendBookingLinkSMS(from, {
      clinicName: clinic.name,
      bookingUrl: `${appUrl}/booking/${clinic.slug}`,
    });

    if (!result.success) {
      logDebug("[voice] Booking link SMS failed - connecting call anyway", {
        error: result.error,
      });
      return connectOrClose(forwardTo, spoken);
    }

    return connectOrClose(
      forwardTo,
      `${spoken} We've just texted you a link to book online, which is the fastest way to see all open appointment times. ` +
        `Stay on the line to speak with us.`,
    );
  } catch (error) {
    // Never let an internal error drop a patient's call.
    logDebug("[voice] Unexpected error - connecting call anyway", {
      error: error instanceof Error ? error.message : String(error),
    });
    return connectOrClose(forwardTo, spoken);
  }
}
