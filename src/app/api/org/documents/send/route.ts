/**
 * POST /api/org/documents/send
 * Org admin requests documents from a patient: creates a tokenized upload
 * request and emails the patient a secure, expiring link.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getOrgAdminContext } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { consumeRateLimit } from "@/lib/invitation-security";
import { generateDocumentToken } from "@/lib/document-token";
import { sendDocumentRequestEmail } from "@/lib/booking-email";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { resolveAppUrl } from "@/lib/app-url";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NOTE_LENGTH = 500;
const DEMOGRAPHIC_NO_RE = /^[0-9]{1,12}$/;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    const orgContext = await getOrgAdminContext(session);
    // !session is redundant for authorization (getOrgAdminContext(null) is null); it is here
    // so session narrows for the created_by_user_id/type columns written below.
    if (!session || !orgContext) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/documents/send", requestId, status, Date.now() - started);
      return res;
    }

    const rl = await consumeRateLimit(`documents:send:${orgContext.organizationId}`, 30, 600);
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
    // Optional: what the clinic is asking for, e.g. "photo of the eyelid swelling".
    const requestNote = (body?.requestNote as string | undefined)?.trim() || null;
    // Optional: set when this request was started from the OSCAR eChart's "Request
    // Docs" button, so uploaded files can later be filed into that same chart.
    const rawDemographicNo = (body?.oscarDemographicNo as string | undefined)?.trim() || "";
    const oscarDemographicNo = DEMOGRAPHIC_NO_RE.test(rawDemographicNo) ? rawDemographicNo : null;

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

    if (requestNote && requestNote.length > MAX_NOTE_LENGTH) {
      status = 400;
      const res = NextResponse.json(
        { error: `Please keep the request under ${MAX_NOTE_LENGTH} characters.` },
        { status },
      );
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
      [orgContext.organizationId],
    );

    if (!orgResult.rows.length) {
      status = 404;
      const res = NextResponse.json({ error: "Organization not found." }, { status });
      logRequestMeta("/api/org/documents/send", requestId, status, Date.now() - started);
      return res;
    }

    const org = orgResult.rows[0];
    const { raw, hash, expiresAt } = generateDocumentToken();

    // created_by_user_id can now be either an organization_users.id or a physicians.id, so
    // record which table it points at — the column has no FK to disambiguate it.
    const inserted = await query<{ id: string }>(
      `INSERT INTO patient_document_requests
         (organization_id, created_by_user_id, created_by_user_type, patient_name, patient_email,
          token_hash, expires_at, request_note, oscar_demographic_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        orgContext.organizationId,
        session.userId,
        session.userType,
        patientName,
        patientEmail,
        hash,
        expiresAt,
        requestNote,
        oscarDemographicNo,
      ],
    );

    const uploadUrl = `${resolveAppUrl(request)}/upload/${raw}`;

    const emailResult = await sendDocumentRequestEmail({
      email: patientEmail,
      patientName,
      clinicName: org.name,
      uploadUrl,
      expiresAt,
      requestNote,
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
