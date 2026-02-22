import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import {
  canAccessSessionInScope,
  loadSessionAccessScope,
  loadSessionPatientId,
} from "@/lib/session-access";

export const runtime = "nodejs";

/**
 * POST /api/sessions/reviewed
 * Marks a patient session as reviewed by the physician.
 *
 * Persists the reviewed timestamp inside the session's `history` JSONB
 * to avoid schema migrations.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required" }, { status });
      logRequestMeta("/api/sessions/reviewed", requestId, status, Date.now() - started);
      return res;
    }
    const body = (await request.json().catch(() => ({}))) as { sessionCode?: unknown };
    const sessionCode = typeof body.sessionCode === "string" ? body.sessionCode.trim() : "";
    if (!sessionCode) {
      status = 400;
      const res = NextResponse.json({ error: "sessionCode is required" }, { status });
      logRequestMeta("/api/sessions/reviewed", requestId, status, Date.now() - started);
      return res;
    }

    const scope = await loadSessionAccessScope(sessionCode);
    if (!scope) {
      status = 404;
      const res = NextResponse.json({ error: "Session not found" }, { status });
      logRequestMeta("/api/sessions/reviewed", requestId, status, Date.now() - started);
      return res;
    }
    if (!canAccessSessionInScope({ viewer: session, resource: scope })) {
      status = 403;
      const res = NextResponse.json({ error: "Access denied" }, { status });
      logRequestMeta("/api/sessions/reviewed", requestId, status, Date.now() - started);
      return res;
    }

    const reviewedAtIso = new Date().toISOString();

    const result = await query(
      `UPDATE patient_sessions
       SET history = jsonb_set(history, '{physicianReviewedAt}', to_jsonb($2::text), true)
       WHERE session_code = $1`,
      [sessionCode, reviewedAtIso],
    );

    if ((result.rowCount ?? 0) === 0) {
      status = 404;
      const res = NextResponse.json({ error: "Session not found" }, { status });
      logRequestMeta("/api/sessions/reviewed", requestId, status, Date.now() - started);
      return res;
    }

    try {
      const patientId = await loadSessionPatientId(sessionCode);
      await logPhysicianPhiAudit({
        physicianId: session.userId,
        patientId,
        eventType: "session_marked_reviewed",
        ipAddress: getRequestIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        metadata: {
          sessionCode,
          viewerUserType: session.userType,
        },
      });
    } catch {
      // Best-effort audit logging.
    }

    const res = NextResponse.json({ success: true, reviewedAt: reviewedAtIso });
    logRequestMeta("/api/sessions/reviewed", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[sessions-reviewed-route] Error marking session reviewed", { requestId });
    status = 500;
    const res = NextResponse.json({ error: "Failed to mark session reviewed" }, { status });
    logRequestMeta("/api/sessions/reviewed", requestId, status, Date.now() - started);
    return res;
  }
}

