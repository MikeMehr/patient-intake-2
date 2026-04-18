import { NextRequest, NextResponse } from "next/server";
import {
  INVITATION_SESSION_COOKIE,
  consumeRateLimit,
  createInvitationSession,
  getInvitationByRawToken,
  getRequestIp,
  isInvitationOpenable,
  logInvitationAudit,
  maskEmail,
} from "@/lib/invitation-security";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

type InvalidReason = "used" | "revoked" | "expired" | null;

function getInvalidReason(invitation: {
  usedAt: string | null;
  revokedAt: string | null;
  tokenExpiresAt: string | null;
  expiresAt: string | null;
}): InvalidReason {
  if (invitation.revokedAt) return "revoked";
  if (invitation.usedAt) return "used";
  const expiry = invitation.tokenExpiresAt || invitation.expiresAt;
  if (expiry && new Date(expiry).getTime() <= Date.now()) return "expired";
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const ipAddress = getRequestIp(request.headers);
  const userAgent = request.headers.get("user-agent");

  try {
    const { token } = await params;
    if (!token) {
      status = 400;
      const res = NextResponse.json({ error: "Invitation token is required" }, { status });
      logRequestMeta("/api/invitations/open/[token]", requestId, status, Date.now() - started);
      return res;
    }

    const limiter = await consumeRateLimit(`invite-open:${ipAddress}`, 25, 60);
    if (!limiter.allowed) {
      status = 429;
      const res = NextResponse.json(
        { error: "Too many invitation open attempts", retryAfterSeconds: limiter.retryAfterSeconds },
        { status },
      );
      logRequestMeta("/api/invitations/open/[token]", requestId, status, Date.now() - started);
      return res;
    }

    const invitation = await getInvitationByRawToken(token);
    if (!invitation) {
      await logInvitationAudit({
        invitationId: null,
        eventType: "invite_open_failed",
        ipAddress,
        userAgent,
        metadata: { reason: "not_found" },
      });
      status = 404;
      const res = NextResponse.json({ error: "Invitation not found" }, { status });
      logRequestMeta("/api/invitations/open/[token]", requestId, status, Date.now() - started);
      return res;
    }

    const openable = await isInvitationOpenable(invitation);
    const invalidReason = getInvalidReason(invitation);
    if (!openable) {
      await logInvitationAudit({
        invitationId: invitation.invitationId,
        eventType: "invite_open_failed",
        ipAddress,
        userAgent,
        metadata: { reason: invalidReason || "expired_or_used_or_revoked" },
      });
    }

    if (openable) {
      await logInvitationAudit({
        invitationId: invitation.invitationId,
        eventType: "invite_opened",
        ipAddress,
        userAgent,
      });
    }

    const res = NextResponse.json({
      invitationId: invitation.invitationId,
      physicianName: invitation.physicianName,
      clinicName: invitation.clinicName,
      // Note: we still return patientName here even when openable=false so the client
      // can detect cookie/token mismatches and show a friendlier UI. The token itself
      // remains unguessable; full patient email is only revealed after OTP verification.
      patientName: invitation.patientName,
      maskedEmail: maskEmail(invitation.patientEmail),
      tokenExpiresAt: invitation.tokenExpiresAt || invitation.expiresAt,
      openable,
      invalidReason,
      require2fa: invitation.require2fa,
    });
    logRequestMeta("/api/invitations/open/[token]", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[invitations/open] Error", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/invitations/open/[token]", requestId, status, Date.now() - started);
    return res;
  }
}

/**
 * POST /api/invitations/open/[token]
 * Grant a session directly for invitations where require_2fa is false.
 * Rejects with 403 if the invitation requires 2FA.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const ipAddress = getRequestIp(request.headers);
  const userAgent = request.headers.get("user-agent");

  try {
    const { token } = await params;
    if (!token) {
      status = 400;
      const res = NextResponse.json({ error: "Invitation token is required" }, { status });
      logRequestMeta("/api/invitations/open/[token] POST", requestId, status, Date.now() - started);
      return res;
    }

    const limiter = await consumeRateLimit(`invite-open-post:${ipAddress}`, 10, 60);
    if (!limiter.allowed) {
      status = 429;
      const res = NextResponse.json(
        { error: "Too many attempts", retryAfterSeconds: limiter.retryAfterSeconds },
        { status },
      );
      logRequestMeta("/api/invitations/open/[token] POST", requestId, status, Date.now() - started);
      return res;
    }

    const invitation = await getInvitationByRawToken(token);
    if (!invitation || !(await isInvitationOpenable(invitation))) {
      status = 404;
      const res = NextResponse.json({ error: "Invitation is invalid" }, { status });
      logRequestMeta("/api/invitations/open/[token] POST", requestId, status, Date.now() - started);
      return res;
    }

    if (invitation.require2fa) {
      status = 403;
      const res = NextResponse.json({ error: "This invitation requires email verification" }, { status });
      logRequestMeta("/api/invitations/open/[token] POST", requestId, status, Date.now() - started);
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
      metadata: { bypass2fa: true },
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
      sameSite: "lax",
      domain: process.env.INVITATION_SESSION_COOKIE_DOMAIN || undefined,
      path: "/",
      maxAge: Math.max(1, Math.floor((session.expiresAtMs - Date.now()) / 1000)),
    });
    logRequestMeta("/api/invitations/open/[token] POST", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[invitations/open POST] Error", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/invitations/open/[token] POST", requestId, status, Date.now() - started);
    return res;
  }
}
