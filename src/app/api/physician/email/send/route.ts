/**
 * POST /api/physician/email/send
 * Send a one-way email to a patient from the clinic's sending address.
 * Reply-To is set to the physician's organization email.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { Resend } from "resend";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { consumeRateLimit } from "@/lib/invitation-security";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// 10 MB per attachment hard cap
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// 5 attachments max
const MAX_ATTACHMENTS = 5;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required" }, { status });
      logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(session);

    // Rate limit: 30 emails per physician per 10 minutes
    const rl = await consumeRateLimit(`email:send:${physicianId}`, 30, 600);
    if (!rl.allowed) {
      status = 429;
      const res = NextResponse.json(
        { error: "Too many email requests. Please try again later." },
        { status, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
      logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
      return res;
    }

    // Parse multipart form data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid form data." }, { status });
      logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
      return res;
    }

    const to = (formData.get("to") as string | null)?.trim();
    const subject = (formData.get("subject") as string | null)?.trim();
    const body = (formData.get("body") as string | null)?.trim();
    const files = formData.getAll("files") as File[];

    if (!to || !subject || !body) {
      status = 400;
      const res = NextResponse.json(
        { error: "Recipient email, subject, and body are required." },
        { status }
      );
      logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
      return res;
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid recipient email address." }, { status });
      logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
      return res;
    }

    if (files.length > MAX_ATTACHMENTS) {
      status = 400;
      const res = NextResponse.json(
        { error: `Maximum ${MAX_ATTACHMENTS} attachments allowed.` },
        { status }
      );
      logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
      return res;
    }

    // Fetch organization email for Reply-To
    const orgResult = await query<{ org_email: string | null; physician_email: string }>(
      `SELECT o.email AS org_email, p.email AS physician_email
       FROM physicians p
       LEFT JOIN organizations o ON o.id = p.organization_id
       WHERE p.id = $1`,
      [physicianId]
    );

    if (!orgResult.rows.length) {
      status = 404;
      const res = NextResponse.json({ error: "Physician not found." }, { status });
      logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
      return res;
    }

    const { org_email, physician_email } = orgResult.rows[0];
    const replyTo = org_email || physician_email;

    // Build attachments
    const attachments: { filename: string; content: Buffer }[] = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        status = 400;
        const res = NextResponse.json(
          { error: `Attachment "${file.name}" exceeds the 10 MB size limit.` },
          { status }
        );
        logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
        return res;
      }
      const buf = Buffer.from(await file.arrayBuffer());
      attachments.push({ filename: file.name, content: buf });
    }

    if (!resend) {
      status = 503;
      const res = NextResponse.json({ error: "Email service not configured." }, { status });
      logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
      return res;
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@health-assist.org";

    const sendResult = await resend.emails.send({
      from: fromEmail,
      to: [to],
      replyTo: replyTo,
      subject,
      html: body,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    });

    if (sendResult.error) {
      console.error("[api/physician/email/send] Resend error:", sendResult.error);
      status = 502;
      const res = NextResponse.json({ error: "Failed to send email. Please try again." }, { status });
      logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({ success: true, id: sendResult.data?.id }, { status });
    logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/email/send] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/email/send", requestId, status, Date.now() - started);
    return res;
  }
}
