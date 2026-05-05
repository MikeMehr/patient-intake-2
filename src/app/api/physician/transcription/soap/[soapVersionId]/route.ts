import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getSoapVersionByIdForScope, resolveWorkforceScope } from "@/lib/transcription-store";
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
    const scope = resolveWorkforceScope({
      userType: auth.userType,
      userId: getEffectivePhysicianId(auth),
      organizationId: auth.organizationId || null,
    });
    if (!scope) {
      status = 403;
      const res = NextResponse.json({ error: "Workforce access required." }, { status });
      logRequestMeta("/api/physician/transcription/soap/[soapVersionId]", requestId, status, Date.now() - started);
      return res;
    }
    const { soapVersionId } = await ctx.params;
    const soap = await getSoapVersionByIdForScope({ soapVersionId, scope, physicianId: getEffectivePhysicianId(auth) });
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
      chiefComplaint: soap.chief_complaint ?? null,
      draft: {
        subjective: soap.subjective,
        objective: soap.objective,
        assessment: soap.assessment,
        plan: soap.plan,
      },
      snapshotLabel: HEALTHASSIST_SNAPSHOT_LABEL,
    });
    try {
      await logPhysicianPhiAudit({
        physicianId: getEffectivePhysicianId(auth),
        patientId: soap.patient_id,
        encounterId: soap.encounter_id,
        soapVersionId: soap.id,
        eventType: "transcription_soap_viewed",
        ipAddress: getRequestIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        metadata: {
          requestId,
          viewerUserType: auth.userType,
        },
      });
    } catch {
      // Best-effort audit logging.
    }
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
