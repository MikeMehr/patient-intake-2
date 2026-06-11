import { NextRequest, NextResponse } from "next/server";
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
import { sendVerificationSMS } from "@/lib/sms";

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

    if (!invitation.require2fa) {
      status = 400;
      const res = NextResponse.json({ error: "This invitation does not require verification" }, { status });
      logRequestMeta("/api/invitations/otp/request", requestId, status, Date.now() - started);
      return res;
    }

    if (!invitation.patientPhone || invitation.patientPhone.replace(/\D/g, "").length < 10) {
      status = 400;
      const res = NextResponse.json(
        { error: "No phone number on file for this invitation. Please contact your clinic." },
        { status },
      );
      logRequestMeta("/api/invitations/otp/request", requestId, status, Date.now() - started);
      return res;
    }

    const otp = createOtpCode();
    await upsertOtpChallenge(invitation.invitationId, otp);

    let smsSent = false;
    if (process.env.HIPAA_MODE !== "true" && process.env.DISABLE_SCAN_EMAILS !== "true") {
      const smsResult = await sendVerificationSMS(invitation.patientPhone, otp, invitation.clinicName);
      smsSent = smsResult.success;
      if (!smsResult.success) {
        console.error("[invitations/otp/request] SMS send failed", smsResult.error);
        status = 502;
        const res = NextResponse.json({ error: "Failed to send verification code by SMS." }, { status });
        logRequestMeta("/api/invitations/otp/request", requestId, status, Date.now() - started);
        return res;
      }
    }

    await logInvitationAudit({
      invitationId: invitation.invitationId,
      eventType: "otp_requested",
      ipAddress,
      userAgent,
      metadata: { channel: "sms", smsSent },
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
