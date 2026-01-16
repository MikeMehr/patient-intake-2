import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getSessionsByPhysician } from "@/lib/session-store";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { logDebug } from "@/lib/secure-logger";

/**
 * GET /api/sessions/list
 * Get all patient sessions for the logged-in physician
 * Requires authentication
 */
export async function GET(request: NextRequest) {
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

    // Only providers can view sessions
    if (session.userType !== "provider") {
      status = 403;
      const res = NextResponse.json(
        { error: "Only providers can view patient sessions" },
        { status }
      );
      logRequestMeta("/api/sessions/list", requestId, status, Date.now() - started);
      return res;
    }

    // Get sessions for this physician only
    // Use userId for the new session format, or fall back to physicianId for legacy sessions
    const physicianId = (session as any).physicianId || session.userId;
    
    logDebug("[sessions-list-route] Fetching sessions", {
      physicianId,
      userId: session.userId,
      userType: session.userType,
      hasLegacyPhysicianId: !!(session as any).physicianId
    });
    
    const sessions = await getSessionsByPhysician(physicianId);
    
    logDebug("[sessions-list-route] Found sessions", { count: sessions.length });

    // Convert Date objects to ISO strings for JSON serialization
    const serializedSessions = sessions.map(s => ({
      ...s,
      completedAt: s.completedAt.toISOString(),
      viewedAt: s.viewedAt?.toISOString(),
    }));

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
