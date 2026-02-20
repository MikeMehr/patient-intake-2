import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { markExportedRequestSchema } from "@/lib/transcription-schema";
import { getSoapVersionById, recordEmrExportAttempt } from "@/lib/transcription-store";
import { EMR_EXPORT_STATUS, HEALTHASSIST_SNAPSHOT_LABEL, SOAP_LIFECYCLE_STATES } from "@/lib/transcription-policy";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/transcription/mark-exported", requestId, status, Date.now() - started);
      return res;
    }
    if (auth.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/transcription/mark-exported", requestId, status, Date.now() - started);
      return res;
    }
    const body = await request.json().catch(() => null);
    const parsed = markExportedRequestSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid payload.", details: parsed.error.format() }, { status });
      logRequestMeta("/api/physician/transcription/mark-exported", requestId, status, Date.now() - started);
      return res;
    }
    const physicianId = (auth as any).physicianId || auth.userId;
    const version = await getSoapVersionById({
      soapVersionId: parsed.data.soapVersionId,
      physicianId,
    });
    if (!version) {
      status = 404;
      const res = NextResponse.json({ error: "SOAP version not found." }, { status });
      logRequestMeta("/api/physician/transcription/mark-exported", requestId, status, Date.now() - started);
      return res;
    }
    if (version.lifecycle_state !== SOAP_LIFECYCLE_STATES.FINALIZED_FOR_EXPORT) {
      status = 409;
      const res = NextResponse.json({ error: "Only FINALIZED_FOR_EXPORT notes can be marked exported." }, { status });
      logRequestMeta("/api/physician/transcription/mark-exported", requestId, status, Date.now() - started);
      return res;
    }
    const exportAttempt = await recordEmrExportAttempt({
      soapVersionId: parsed.data.soapVersionId,
      physicianId,
      idempotencyKey: parsed.data.idempotencyKey,
      status: EMR_EXPORT_STATUS.SENT,
      destinationSystem: parsed.data.destinationSystem,
      destinationClinic: parsed.data.destinationClinic,
      externalReferenceId: parsed.data.externalReferenceId,
    });

    await logPhysicianPhiAudit({
      physicianId,
      patientId: exportAttempt.patientId,
      encounterId: exportAttempt.encounterId,
      soapVersionId: parsed.data.soapVersionId,
      eventType: "transcription_marked_exported",
      ipAddress: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        requestId,
        exportAttemptId: exportAttempt.id,
        destinationSystem: parsed.data.destinationSystem || null,
        destinationClinic: parsed.data.destinationClinic || null,
        hasExternalReferenceId: Boolean(parsed.data.externalReferenceId),
      },
    });

    const res = NextResponse.json({
      success: true,
      exportAttemptId: exportAttempt.id,
      snapshotLabel: HEALTHASSIST_SNAPSHOT_LABEL,
      message:
        "Marked as exported. This records a manual EMR transfer attempt; final authoritative note may differ in clinic EMR.",
    });
    logRequestMeta("/api/physician/transcription/mark-exported", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/transcription/mark-exported] failed:", error);
    const res = NextResponse.json({ error: "Failed to mark export attempt." }, { status });
    logRequestMeta("/api/physician/transcription/mark-exported", requestId, status, Date.now() - started);
    return res;
  }
}
