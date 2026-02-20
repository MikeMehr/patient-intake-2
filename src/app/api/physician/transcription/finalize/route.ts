import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { finalizeSoapRequestSchema } from "@/lib/transcription-schema";
import { finalizeSoapVersion } from "@/lib/transcription-store";
import { HEALTHASSIST_SNAPSHOT_LABEL } from "@/lib/transcription-policy";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/transcription/finalize", requestId, status, Date.now() - started);
      return res;
    }
    if (auth.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/transcription/finalize", requestId, status, Date.now() - started);
      return res;
    }
    const body = await request.json().catch(() => null);
    const parsed = finalizeSoapRequestSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid payload.", details: parsed.error.format() }, { status });
      logRequestMeta("/api/physician/transcription/finalize", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = (auth as any).physicianId || auth.userId;
    const finalized = await finalizeSoapVersion({
      soapVersionId: parsed.data.soapVersionId,
      physicianId,
    });

    await logPhysicianPhiAudit({
      physicianId,
      patientId: finalized.patientId,
      encounterId: finalized.encounterId,
      soapVersionId: parsed.data.soapVersionId,
      eventType: "transcription_soap_finalized_for_export",
      ipAddress: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        requestId,
        version: finalized.version,
      },
    });

    const res = NextResponse.json({
      success: true,
      soapVersionId: parsed.data.soapVersionId,
      lifecycleState: "FINALIZED_FOR_EXPORT",
      snapshotLabel: HEALTHASSIST_SNAPSHOT_LABEL,
    });
    logRequestMeta("/api/physician/transcription/finalize", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/transcription/finalize] failed:", error);
    const res = NextResponse.json({ error: "Failed to finalize SOAP draft." }, { status });
    logRequestMeta("/api/physician/transcription/finalize", requestId, status, Date.now() - started);
    return res;
  }
}
