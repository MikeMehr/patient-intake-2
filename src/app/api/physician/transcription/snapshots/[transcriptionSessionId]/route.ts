import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import {
  deleteTranscriptionSessionByIdForScope,
  resolveWorkforceScope,
} from "@/lib/transcription-store";

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ transcriptionSessionId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta(
        "/api/physician/transcription/snapshots/[transcriptionSessionId]",
        requestId,
        status,
        Date.now() - started,
      );
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
      logRequestMeta(
        "/api/physician/transcription/snapshots/[transcriptionSessionId]",
        requestId,
        status,
        Date.now() - started,
      );
      return res;
    }

    const { transcriptionSessionId } = await ctx.params;
    const targetId = String(transcriptionSessionId || "").trim();
    if (!targetId) {
      status = 400;
      const res = NextResponse.json({ error: "transcriptionSessionId is required." }, { status });
      logRequestMeta(
        "/api/physician/transcription/snapshots/[transcriptionSessionId]",
        requestId,
        status,
        Date.now() - started,
      );
      return res;
    }

    const deleted = await deleteTranscriptionSessionByIdForScope({
      transcriptionSessionId: targetId,
      scope,
    });
    if (!deleted.deleted) {
      status = 404;
      const res = NextResponse.json({ error: "Snapshot not found." }, { status });
      logRequestMeta(
        "/api/physician/transcription/snapshots/[transcriptionSessionId]",
        requestId,
        status,
        Date.now() - started,
      );
      return res;
    }

    const res = NextResponse.json({
      success: true,
      transcriptionSessionId: targetId,
      soapVersionId: deleted.soapVersionId,
    });
    logRequestMeta(
      "/api/physician/transcription/snapshots/[transcriptionSessionId]",
      requestId,
      status,
      Date.now() - started,
    );
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/transcription/snapshots/[transcriptionSessionId]] delete failed:", error);
    const res = NextResponse.json({ error: "Failed to delete transcription snapshot." }, { status });
    logRequestMeta(
      "/api/physician/transcription/snapshots/[transcriptionSessionId]",
      requestId,
      status,
      Date.now() - started,
    );
    return res;
  }
}
