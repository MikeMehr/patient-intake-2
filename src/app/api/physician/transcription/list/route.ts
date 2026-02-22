import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import {
  getTranscriptionSessionsForScope,
  resolveWorkforceScope,
} from "@/lib/transcription-store";
import { HEALTHASSIST_SNAPSHOT_LABEL } from "@/lib/transcription-policy";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/transcription/list", requestId, status, Date.now() - started);
      return res;
    }
    const scope = resolveWorkforceScope({
      userType: auth.userType,
      userId: auth.userId,
      organizationId: auth.organizationId || null,
    });
    if (!scope) {
      status = 403;
      const res = NextResponse.json({ error: "Workforce access required." }, { status });
      logRequestMeta("/api/physician/transcription/list", requestId, status, Date.now() - started);
      return res;
    }
    const items = await getTranscriptionSessionsForScope(scope);
    try {
      await logPhysicianPhiAudit({
        physicianId: auth.userId,
        eventType: "transcription_list_viewed",
        ipAddress: getRequestIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        metadata: {
          requestId,
          viewerUserType: auth.userType,
          returnedCount: items.length,
        },
      });
    } catch {
      // Best-effort audit logging.
    }
    const res = NextResponse.json({ items, snapshotLabel: HEALTHASSIST_SNAPSHOT_LABEL });
    logRequestMeta("/api/physician/transcription/list", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/transcription/list] failed:", error);
    const res = NextResponse.json({ error: "Failed to load transcription sessions." }, { status });
    logRequestMeta("/api/physician/transcription/list", requestId, status, Date.now() - started);
    return res;
  }
}
