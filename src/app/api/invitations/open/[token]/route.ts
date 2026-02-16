import { NextRequest, NextResponse } from "next/server";
import {
  consumeRateLimit,
  getInvitationByRawToken,
  getRequestIp,
  isInvitationOpenable,
  logInvitationAudit,
  maskEmail,
} from "@/lib/invitation-security";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

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
    if (!openable) {
      await logInvitationAudit({
        invitationId: invitation.invitationId,
        eventType: "invite_open_failed",
        ipAddress,
        userAgent,
        metadata: { reason: "expired_or_used_or_revoked" },
      });
      status = 410;
      const res = NextResponse.json(
        { error: "This invitation is no longer valid." },
        { status },
      );
      logRequestMeta("/api/invitations/open/[token]", requestId, status, Date.now() - started);
      return res;
    }

    await logInvitationAudit({
      invitationId: invitation.invitationId,
      eventType: "invite_opened",
      ipAddress,
      userAgent,
    });

    const res = NextResponse.json({
      invitationId: invitation.invitationId,
      physicianName: invitation.physicianName,
      clinicName: invitation.clinicName,
      patientName: invitation.patientName,
      maskedEmail: maskEmail(invitation.patientEmail),
      tokenExpiresAt: invitation.tokenExpiresAt || invitation.expiresAt,
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
