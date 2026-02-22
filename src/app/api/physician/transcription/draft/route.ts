import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { saveSoapDraftRequestSchema } from "@/lib/transcription-schema";
import {
  getSoapVersionByIdForScope,
  resolveWorkforceScope,
  updateSoapDraftVersion,
  upsertTranscriptionSessionPointer,
} from "@/lib/transcription-store";
import { HEALTHASSIST_SNAPSHOT_LABEL } from "@/lib/transcription-policy";

function buildPreview(subjective: string, assessment: string) {
  const text = `${subjective.trim()} ${assessment.trim()}`.trim();
  if (!text) return null;
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/transcription/draft", requestId, status, Date.now() - started);
      return res;
    }
    if (auth.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/transcription/draft", requestId, status, Date.now() - started);
      return res;
    }
    const scope = resolveWorkforceScope({
      userType: auth.userType,
      userId: auth.userId,
      organizationId: auth.organizationId || null,
    });
    if (!scope) {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/transcription/draft", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = saveSoapDraftRequestSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid payload.", details: parsed.error.format() }, { status });
      logRequestMeta("/api/physician/transcription/draft", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = auth.userId;
    const version = await getSoapVersionByIdForScope({
      soapVersionId: parsed.data.soapVersionId,
      scope,
    });
    if (!version) {
      status = 404;
      const res = NextResponse.json({ error: "SOAP draft not found." }, { status });
      logRequestMeta("/api/physician/transcription/draft", requestId, status, Date.now() - started);
      return res;
    }
    await updateSoapDraftVersion({
      soapVersionId: parsed.data.soapVersionId,
      scope,
      draft: parsed.data.draft,
    });
    await upsertTranscriptionSessionPointer({
      physicianId,
      patientId: version.patient_id,
      encounterId: version.encounter_id,
      soapVersionId: parsed.data.soapVersionId,
      previewSummary: buildPreview(parsed.data.draft.subjective, parsed.data.draft.assessment),
    });
    await logPhysicianPhiAudit({
      physicianId,
      patientId: version.patient_id,
      encounterId: version.encounter_id,
      soapVersionId: parsed.data.soapVersionId,
      eventType: "transcription_soap_draft_updated",
      ipAddress: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      metadata: { requestId },
    });

    const res = NextResponse.json({
      success: true,
      soapVersionId: parsed.data.soapVersionId,
      lifecycleState: "DRAFT",
      snapshotLabel: HEALTHASSIST_SNAPSHOT_LABEL,
    });
    logRequestMeta("/api/physician/transcription/draft", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/transcription/draft] failed:", error);
    const res = NextResponse.json({ error: "Failed to update SOAP draft." }, { status });
    logRequestMeta("/api/physician/transcription/draft", requestId, status, Date.now() - started);
    return res;
  }
}
