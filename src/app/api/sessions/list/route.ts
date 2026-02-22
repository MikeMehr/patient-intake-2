import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getSessionsByScope } from "@/lib/session-store";
import { query } from "@/lib/db";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { logDebug } from "@/lib/secure-logger";
import { getRequestIp } from "@/lib/invitation-security";
import { isWorkforceSessionViewer } from "@/lib/session-access";
import { startSessionRetentionCleanup } from "@/lib/session-retention-cleanup";

function isUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * GET /api/sessions/list
 * Get all patient sessions for the logged-in physician
 * Requires authentication
 */
export async function GET(request: NextRequest) {
  startSessionRetentionCleanup();
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    // Require authentication
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = NextResponse.json(
        { error: "Authentication required" },
        { status }
      );
      logRequestMeta("/api/sessions/list", requestId, status, Date.now() - started);
      return res;
    }

    if (!isWorkforceSessionViewer(session)) {
      status = 403;
      const res = NextResponse.json(
        { error: "Workforce access required" },
        { status }
      );
      logRequestMeta("/api/sessions/list", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = (session as any).physicianId || session.userId;
    const orgId = session.organizationId || null;

    if (session.userType === "org_admin" && !orgId) {
      status = 403;
      const res = NextResponse.json(
        { error: "Organization-scoped access required" },
        { status }
      );
      logRequestMeta("/api/sessions/list", requestId, status, Date.now() - started);
      return res;
    }
    
    logDebug("[sessions-list-route] Fetching sessions", {
      physicianId,
      userId: session.userId,
      userType: session.userType,
      hasLegacyPhysicianId: !!(session as any).physicianId
    });
    
    const sessions = await getSessionsByScope({
      organizationId: orgId,
      physicianId,
    });
    
    logDebug("[sessions-list-route] Found sessions", { count: sessions.length });

    // Attach patientId when the intake session has been charted into patient_encounters.
    // (Best-effort: if the chart tables aren't present yet, we still return sessions.)
    const sessionCodes = sessions.map((s) => s.sessionCode).filter(Boolean);
    let patientIdByCode = new Map<string, string>();
    if (sessionCodes.length > 0) {
      try {
        const enc = await query<{ source_session_code: string; patient_id: string }>(
          `SELECT pe.source_session_code, pe.patient_id
           FROM patient_encounters pe
           JOIN patients p ON p.id = pe.patient_id
           WHERE pe.source_session_code = ANY($1::text[])
             AND (
               (
                 $2::uuid IS NOT NULL
                 AND (
                   p.organization_id = $2::uuid
                   OR (p.organization_id IS NULL AND p.primary_physician_id = $3::uuid)
                 )
               )
               OR
               ($2::uuid IS NULL AND p.organization_id IS NULL AND p.primary_physician_id = $3::uuid)
             )`,
          [sessionCodes, orgId, physicianId],
        );
        patientIdByCode = new Map(
          enc.rows
            .filter(
              (r) =>
                typeof r.source_session_code === "string" &&
                r.source_session_code.trim().length > 0 &&
                isUuid(r.patient_id),
            )
            .map((r) => [r.source_session_code, r.patient_id.trim()]),
        );
      } catch (err) {
        console.error("[sessions-list-route] Failed to load patient encounter mapping", err);
      }
    }

    // Convert Date objects to ISO strings for JSON serialization
    const serializedSessions = sessions.map(s => ({
      ...s,
      patientId: patientIdByCode.get(s.sessionCode) || null,
      completedAt: s.completedAt.toISOString(),
      viewedAt: s.viewedAt?.toISOString(),
    }));

    try {
      await logPhysicianPhiAudit({
        physicianId: session.userId,
        eventType: "session_list_viewed",
        ipAddress: getRequestIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        metadata: {
          viewerUserType: session.userType,
          organizationId: orgId,
          returnedCount: serializedSessions.length,
        },
      });
    } catch {
      // Best-effort audit logging.
    }

    const res = NextResponse.json({ sessions: serializedSessions });
    logRequestMeta("/api/sessions/list", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[sessions-list-route] Error fetching sessions");
    logDebug("[sessions-list-route] Error details", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    status = 500;
    const res = NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status }
    );
    logRequestMeta("/api/sessions/list", requestId, status, Date.now() - started);
    return res;
  }
}
