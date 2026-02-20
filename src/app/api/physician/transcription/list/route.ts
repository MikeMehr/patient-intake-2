import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getTranscriptionSessionsForPhysician } from "@/lib/transcription-store";
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
    if (auth.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/transcription/list", requestId, status, Date.now() - started);
      return res;
    }
    const physicianId = (auth as any).physicianId || auth.userId;
    const items = await getTranscriptionSessionsForPhysician(physicianId);
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
