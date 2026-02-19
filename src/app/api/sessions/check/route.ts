import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { resolveInvitationFromCookie } from "@/lib/invitation-security";
import { query } from "@/lib/db";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  const invitation = await resolveInvitationFromCookie();
  if (!invitation) {
    status = 401;
    const res = NextResponse.json(
      { error: "Invitation session required" },
      { status },
    );
    logRequestMeta("/api/sessions/check", requestId, status, Date.now() - started);
    return res;
  }

  try {
    // Allow repeat intakes for the same patient if a new invitation link was sent.
    // We only want to prevent re-submitting the same invitation after a session was saved.
    let exists = false;
    try {
      const result = await query(
        `SELECT 1
         FROM invitation_audit_log
         WHERE invitation_id = $1
           AND event_type = 'session_saved'
         LIMIT 1`,
        [invitation.invitationId],
      );
      exists = (result.rowCount ?? 0) > 0;
    } catch (err) {
      // Fail open on audit-log issues so invited patients aren't blocked.
      console.error("[sessions-check-route] Audit log query failed; allowing intake", { requestId });
      exists = false;
    }

    const res = NextResponse.json({ exists });
    logRequestMeta("/api/sessions/check", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[sessions-check-route] Error checking patient session existence", { requestId });
    status = 500;
    const res = NextResponse.json(
      { error: "Failed to check session status" },
      { status },
    );
    logRequestMeta("/api/sessions/check", requestId, status, Date.now() - started);
    return res;
  }
}


