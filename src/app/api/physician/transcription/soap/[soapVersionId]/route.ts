import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getSoapVersionById } from "@/lib/transcription-store";
import { HEALTHASSIST_SNAPSHOT_LABEL } from "@/lib/transcription-policy";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ soapVersionId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/transcription/soap/[soapVersionId]", requestId, status, Date.now() - started);
      return res;
    }
    if (auth.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/transcription/soap/[soapVersionId]", requestId, status, Date.now() - started);
      return res;
    }
    const { soapVersionId } = await ctx.params;
    const physicianId = (auth as any).physicianId || auth.userId;
    const soap = await getSoapVersionById({ soapVersionId, physicianId });
    if (!soap) {
      status = 404;
      const res = NextResponse.json({ error: "SOAP version not found." }, { status });
      logRequestMeta("/api/physician/transcription/soap/[soapVersionId]", requestId, status, Date.now() - started);
      return res;
    }
    const res = NextResponse.json({
      soapVersionId: soap.id,
      encounterId: soap.encounter_id,
      patientId: soap.patient_id,
      version: soap.version,
      lifecycleState: soap.lifecycle_state,
      finalizedForExportAt: soap.finalized_for_export_at ? soap.finalized_for_export_at.toISOString() : null,
      draftTranscript: soap.draft_transcript,
      draft: {
        subjective: soap.subjective,
        objective: soap.objective,
        assessment: soap.assessment,
        plan: soap.plan,
      },
      snapshotLabel: HEALTHASSIST_SNAPSHOT_LABEL,
    });
    logRequestMeta("/api/physician/transcription/soap/[soapVersionId]", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/transcription/soap/[soapVersionId]] failed:", error);
    const res = NextResponse.json({ error: "Failed to load SOAP version." }, { status });
    logRequestMeta("/api/physician/transcription/soap/[soapVersionId]", requestId, status, Date.now() - started);
    return res;
  }
}
