/**
 * POST /api/interview-intake/[clinicSlug]/start
 *
 * Public entry point for the self-serve AI Guided Interview (no physician invite).
 * Given a patient's name/email/phone/DOB it:
 *   1. Determines whether the person already exists in the clinic's OSCAR records
 *      (name + DOB, narrowed by email) via the shared lookup helper.
 *   2. Creates a `patient_invitations` row programmatically (is_self_serve = TRUE),
 *      attached to the clinic's designated default physician, reusing the same
 *      invitation spine the physician-invite flow uses.
 *   3. Returns the raw token + patientType so the client can (for new patients)
 *      collect full demographics, then run the shared SMS OTP flow.
 *
 * Security:
 *  - Rate-limited per IP and per phone number to bound SMS/abuse and OSCAR reads.
 *  - The OSCAR lookup is fused into this endpoint (never standalone), and the
 *    response reveals only patientType + maskedPhone — never a demographicNo or
 *    any OSCAR-stored PHI.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSelfServeInterviewConfig } from "@/lib/booking-store";
import { lookupOscarPatient } from "@/lib/oscar/self-serve";
import {
  consumeRateLimit,
  createInvitationToken,
  getRequestIp,
  logInvitationAudit,
  maskPhone,
} from "@/lib/invitation-security";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

const DOB_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LEN = 100;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const route = "/api/interview-intake/start";

  try {
    const { clinicSlug } = await params;
    const ip = getRequestIp(request.headers);
    const userAgent = request.headers.get("user-agent");

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid JSON" }, { status });
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }

    const firstName = String(body.firstName ?? "").trim().slice(0, MAX_NAME_LEN);
    const lastName = String(body.lastName ?? "").trim().slice(0, MAX_NAME_LEN);
    const email = String(body.email ?? "").trim().toLowerCase();
    const phone = String(body.phone ?? "").trim();
    const dateOfBirth = String(body.dateOfBirth ?? "").trim();
    const phoneDigits = phone.replace(/\D/g, "");

    // Validation (mirror /api/invitations/send).
    if (!firstName || !lastName) {
      status = 400;
      const res = NextResponse.json({ error: "First and last name are required." }, { status });
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }
    if (!EMAIL_REGEX.test(email)) {
      status = 400;
      const res = NextResponse.json({ error: "A valid email address is required." }, { status });
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }
    if (phoneDigits.length < 10) {
      status = 400;
      const res = NextResponse.json(
        { error: "A valid mobile phone number is required for SMS verification." },
        { status },
      );
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }
    if (!DOB_REGEX.test(dateOfBirth)) {
      status = 400;
      const res = NextResponse.json(
        { error: "Date of birth is required in YYYY-MM-DD format." },
        { status },
      );
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }

    // Rate limits: per-IP and per-phone to bound OSCAR reads + SMS spend downstream.
    const ipLimit = await consumeRateLimit(`interview-intake-start:${ip}`, 6, 600);
    if (!ipLimit.allowed) {
      status = 429;
      const res = NextResponse.json(
        { error: "Too many requests. Please try again in a few minutes." },
        { status, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
      );
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }
    const phoneLimit = await consumeRateLimit(`interview-intake-start-phone:${phoneDigits}`, 6, 600);
    if (!phoneLimit.allowed) {
      status = 429;
      const res = NextResponse.json(
        { error: "Too many requests for this phone number. Please try again later." },
        { status, headers: { "Retry-After": String(phoneLimit.retryAfterSeconds) } },
      );
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }

    // Resolve clinic + default physician; feature must be enabled with a valid physician.
    const config = await getSelfServeInterviewConfig(clinicSlug);
    if (!config || !config.enabled || !config.physicianId) {
      status = 404;
      const res = NextResponse.json(
        { error: "Self-serve guided interview is not available for this clinic." },
        { status },
      );
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }

    // OSCAR existing-vs-new lookup (name + DOB, narrowed by email).
    const lookup = await lookupOscarPatient(config.clinic.id, {
      firstName,
      lastName,
      dateOfBirth,
      email,
    });

    // Block when we can't make a confident decision — mirror booking's block UX.
    if (
      !lookup.oscarConnected ||
      ("ambiguous" in lookup && lookup.ambiguous) ||
      ("lookupError" in lookup && lookup.lookupError)
    ) {
      const res = NextResponse.json({
        blocked: true,
        clinicEmail: config.clinic.email,
      });
      logRequestMeta(route, requestId, status, Date.now() - started);
      return res;
    }

    const existingDemographicNo =
      "found" in lookup && lookup.found ? lookup.demographicNo : null;
    const patientType = existingDemographicNo ? "existing" : "new";

    // Create the invitation row (programmatic, no provider session).
    const { rawToken, tokenHash, expiresAt } = createInvitationToken();
    const patientName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();

    const inserted = await query<{ id: string }>(
      `INSERT INTO patient_invitations (
         physician_id,
         patient_name,
         patient_email,
         patient_phone,
         patient_dob,
         invitation_link,
         token_hash,
         token_expires_at,
         expires_at,
         sent_at,
         oscar_demographic_no,
         require_2fa,
         is_self_serve
       )
       VALUES ($1, $2, $3, $4, $5::date, NULL, $6, $7, $7, NOW(), $8, TRUE, TRUE)
       RETURNING id`,
      [
        config.physicianId,
        patientName,
        email,
        phone,
        dateOfBirth,
        tokenHash,
        expiresAt,
        existingDemographicNo,
      ],
    );

    const invitationId = inserted.rows[0]?.id ?? null;
    if (invitationId) {
      await logInvitationAudit({
        invitationId,
        eventType: "self_serve_intake_started",
        ipAddress: ip,
        userAgent,
        metadata: { clinicSlug, patientType },
      });
    }

    const res = NextResponse.json({
      rawToken,
      patientType,
      maskedPhone: maskPhone(phone),
    });
    logRequestMeta(route, requestId, status, Date.now() - started);
    return res;
  } catch (err) {
    console.error("[interview-intake/start] Unhandled error:", err);
    status = 500;
    const res = NextResponse.json({ error: "An unexpected error occurred." }, { status });
    logRequestMeta(route, requestId, status, Date.now() - started);
    return res;
  }
}
