/**
 * POST /api/org/documents/send
 * Org admin requests documents from a patient: creates a tokenized upload
 * request and emails the patient a secure, expiring link.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { consumeRateLimit } from "@/lib/invitation-security";
import { generateDocumentToken } from "@/lib/document-token";
import { sendDocumentRequestEmail } from "@/lib/booking-email";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveAppUrl(request: NextRequest): string {
  const envUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const requestOrigin = request.nextUrl.origin;

  if (!envUrl) {
    return requestOrigin || "http://localhost:3000";
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      const env = new URL(envUrl);
      const req = new URL(requestOrigin);
      if (
        env.hostname === "localhost" &&
        req.hostname === "localhost" &&
        env.port !== req.port
      ) {
        return requestOrigin;
      }
    } catch {
      return requestOrigin || "http://localhost:3000";
    }
  }

  return envUrl;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/documents/send", requestId, status, Date.now() - started);
      return res;
    }

    const rl = await consumeRateLimit(`documents:send:${session.organizationId}`, 30, 600);
    if (!rl.allowed) {
      status = 429;
      const res = NextResponse.json(
        { error: "Too many document requests. Please try again later." },
        { status, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
      logRequestMeta("/api/org/documents/send", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json().catch(() => ({}));
    const patientName = (body?.patientName as string | undefined)?.trim();
    const patientEmail = (body?.patientEmail as string | undefined)?.trim();

    if (!patientName || !patientEmail) {
      status = 400;
      const res = NextResponse.json(
        { error: "Patient name and email are required." },
        { status },
      );
      logRequestMeta("/api/org/documents/send", requestId, status, Date.now() - started);
      return res;
    }

    if (!EMAIL_REGEX.test(patientEmail)) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid patient email address." }, { status });
      logRequestMeta("/api/org/documents/send", requestId, status, Date.now() - started);
      return res;
    }

    // Clinic name/email (for branded sender) + configured footer.
    const orgResult = await query<{
      name: string;
      email: string | null;
      email_footer: string | null;
    }>(
      `SELECT o.name, o.email, bs.email_footer
       FROM organizations o
       LEFT JOIN booking_settings bs ON bs.organization_id = o.id
       WHERE o.id = $1`,
      [session.organizationId],
    );

    if (!orgResult.rows.length) {
      status = 404;
      const res = NextResponse.json({ error: "Organization not found." }, { status });
      logRequestMeta("/api/org/documents/send", requestId, status, Date.now() - started);
      return res;
    }

    const org = orgResult.rows[0];
    const { raw, hash, expiresAt } = generateDocumentToken();

    const inserted = await query<{ id: string }>(
      `INSERT INTO patient_document_requests
         (organization_id, created_by_user_id, patient_name, patient_email, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [session.organizationId, session.userId, patientName, patientEmail, hash, expiresAt],
    );

    const uploadUrl = `${resolveAppUrl(request)}/upload/${raw}`;

    const emailResult = await sendDocumentRequestEmail({
      email: patientEmail,
      patientName,
      clinicName: org.name,
      uploadUrl,
      expiresAt,
      emailFooter: org.email_footer,
      clinicEmail: org.email,
    });

    if (!emailResult.sent && process.env.NODE_ENV !== "production") {
      // In dev the raw link is logged so the flow can be exercised without email.
      console.log(`[documents] upload link for ${patientEmail}: ${uploadUrl}`);
    }

    const res = NextResponse.json({
      success: true,
      requestId: inserted.rows[0].id,
      emailSent: emailResult.sent,
      // Surface the link in non-prod so it can be tested without a mailbox.
      ...(process.env.NODE_ENV !== "production" ? { uploadUrl } : {}),
    });
    logRequestMeta("/api/org/documents/send", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/org/documents/send] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/documents/send", requestId, status, Date.now() - started);
    return res;
  }
}
