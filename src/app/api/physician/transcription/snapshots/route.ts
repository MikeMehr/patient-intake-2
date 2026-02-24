import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { deleteAllTranscriptionSessionsForScope, resolveWorkforceScope } from "@/lib/transcription-store";

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/transcription/snapshots", requestId, status, Date.now() - started);
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
      logRequestMeta("/api/physician/transcription/snapshots", requestId, status, Date.now() - started);
      return res;
    }
    const result = await deleteAllTranscriptionSessionsForScope({ scope });
    const res = NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
    });
    logRequestMeta("/api/physician/transcription/snapshots", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/transcription/snapshots] delete-all failed:", error);
    const res = NextResponse.json({ error: "Failed to delete transcription snapshots." }, { status });
    logRequestMeta("/api/physician/transcription/snapshots", requestId, status, Date.now() - started);
    return res;
  }
}
