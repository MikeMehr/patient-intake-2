import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import {
  consumeRateLimit,
  createOtpCode,
  getInvitationByRawToken,
  getRequestIp,
  isInvitationOpenable,
  logInvitationAudit,
  upsertOtpChallenge,
} from "@/lib/invitation-security";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const ipAddress = getRequestIp(request.headers);
  const userAgent = request.headers.get("user-agent");

  try {
    const body = (await request.json()) as { token?: string };
    const token = (body?.token || "").trim();
    if (!token) {
      status = 400;
      const res = NextResponse.json({ error: "Token is required" }, { status });
      logRequestMeta("/api/invitations/otp/request", requestId, status, Date.now() - started);
      return res;
    }

    const limiter = await consumeRateLimit(`invite-otp-request:${ipAddress}`, 8, 60);
    if (!limiter.allowed) {
      status = 429;
      const res = NextResponse.json(
        { error: "Too many OTP requests", retryAfterSeconds: limiter.retryAfterSeconds },
        { status },
      );
      logRequestMeta("/api/invitations/otp/request", requestId, status, Date.now() - started);
      return res;
    }

    const invitation = await getInvitationByRawToken(token);
    if (!invitation || !(await isInvitationOpenable(invitation))) {
      status = 404;
      const res = NextResponse.json({ error: "Invitation is invalid" }, { status });
      logRequestMeta("/api/invitations/otp/request", requestId, status, Date.now() - started);
      return res;
    }

    const otp = createOtpCode();
    await upsertOtpChallenge(invitation.invitationId, otp);

    const subject = `${invitation.clinicName} intake verification code`;
    const text = `Your intake verification code is ${otp}. It expires in 10 minutes.`;
    if (resend && process.env.HIPAA_MODE !== "true") {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
        to: invitation.patientEmail,
        subject,
        html: `<p>Your intake verification code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`,
        text,
      });
    }

    await logInvitationAudit({
      invitationId: invitation.invitationId,
      eventType: "otp_requested",
      ipAddress,
      userAgent,
      metadata: { emailSent: !!resend && process.env.HIPAA_MODE !== "true" },
    });

    const res = NextResponse.json({ success: true });
    logRequestMeta("/api/invitations/otp/request", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[invitations/otp/request] Error", error);
    status = 500;
    const res = NextResponse.json({ error: "Failed to request OTP" }, { status });
    logRequestMeta("/api/invitations/otp/request", requestId, status, Date.now() - started);
    return res;
  }
}
