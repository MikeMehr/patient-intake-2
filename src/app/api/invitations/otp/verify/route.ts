import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import {
  INVITATION_SESSION_COOKIE,
  consumeRateLimit,
  createInvitationSession,
  getInvitationByRawToken,
  getRequestIp,
  isInvitationOpenable,
  logInvitationAudit,
  verifyOtpForInvitation,
} from "@/lib/invitation-security";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const ipAddress = getRequestIp(request.headers);
  const userAgent = request.headers.get("user-agent");

  try {
    const body = (await request.json()) as { token?: string; otp?: string };
    const token = (body?.token || "").trim();
    const otp = (body?.otp || "").trim();

    if (!token || !otp || otp.length !== 6) {
      status = 400;
      const res = NextResponse.json({ error: "Token and a 6-digit OTP are required" }, { status });
      logRequestMeta("/api/invitations/otp/verify", requestId, status, Date.now() - started);
      return res;
    }

    const limiter = await consumeRateLimit(`invite-otp-verify:${ipAddress}`, 20, 300);
    if (!limiter.allowed) {
      status = 429;
      const res = NextResponse.json(
        { error: "Too many OTP verification attempts", retryAfterSeconds: limiter.retryAfterSeconds },
        { status },
      );
      logRequestMeta("/api/invitations/otp/verify", requestId, status, Date.now() - started);
      return res;
    }

    const invitation = await getInvitationByRawToken(token);
    if (!invitation || !(await isInvitationOpenable(invitation))) {
      status = 404;
      const res = NextResponse.json({ error: "Invitation is invalid" }, { status });
      logRequestMeta("/api/invitations/otp/verify", requestId, status, Date.now() - started);
      return res;
    }

    const verification = await verifyOtpForInvitation({
      invitationId: invitation.invitationId,
      otpCode: otp,
    });
    if (!verification.ok) {
      await logInvitationAudit({
        invitationId: invitation.invitationId,
        eventType: "otp_failed",
        ipAddress,
        userAgent,
        metadata: { reason: verification.reason || "unknown" },
      });

      status = verification.reason === "cooldown" ? 429 : 400;
      const res = NextResponse.json(
        {
          error:
            verification.reason === "cooldown"
              ? "Too many OTP attempts. Please wait and try again."
              : "Invalid or expired OTP code.",
        },
        { status },
      );
      logRequestMeta("/api/invitations/otp/verify", requestId, status, Date.now() - started);
      return res;
    }

    const session = await createInvitationSession({
      invitationId: invitation.invitationId,
      ipAddress,
      userAgent,
    });

    await logInvitationAudit({
      invitationId: invitation.invitationId,
      eventType: "otp_verified",
      ipAddress,
      userAgent,
    });

    const res = NextResponse.json({
      success: true,
      patientName: invitation.patientName,
      patientEmail: invitation.patientEmail,
      patientDob: invitation.patientDob,
      physicianId: invitation.physicianId,
      physicianName: invitation.physicianName,
      clinicName: invitation.clinicName,
      organizationWebsiteUrl: invitation.organizationWebsiteUrl || null,
    });
    res.cookies.set(INVITATION_SESSION_COOKIE, session.cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // Lax allows the cookie to be sent on top-level navigations (e.g. coming
      // back via an email link) while still providing CSRF resistance for POSTs.
      sameSite: "lax",
      // Optional: set to ".health-assist.org" in Azure if you ever serve from
      // multiple subdomains and want the invite session to persist across them.
      domain: process.env.INVITATION_SESSION_COOKIE_DOMAIN || undefined,
      path: "/",
      maxAge: Math.max(1, Math.floor((session.expiresAtMs - Date.now()) / 1000)),
    });

    logRequestMeta("/api/invitations/otp/verify", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[invitations/otp/verify] Error", error);
    status = 500;
    const res = NextResponse.json({ error: "Failed to verify OTP" }, { status });
    logRequestMeta("/api/invitations/otp/verify", requestId, status, Date.now() - started);
    return res;
  }
}
