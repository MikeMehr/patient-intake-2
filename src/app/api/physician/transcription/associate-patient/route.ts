import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { associatePatientRequestSchema } from "@/lib/transcription-schema";
import {
  assertPhysicianCanAccessPatient,
  resolveWorkforceScope,
  updateEncounterPatient,
} from "@/lib/transcription-store";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/transcription/associate-patient", requestId, status, Date.now() - started);
      return res;
    }
    if (auth.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/transcription/associate-patient", requestId, status, Date.now() - started);
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
      logRequestMeta("/api/physician/transcription/associate-patient", requestId, status, Date.now() - started);
      return res;
    }
    const body = await request.json().catch(() => null);
    const parsed = associatePatientRequestSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid payload.", details: parsed.error.format() }, { status });
      logRequestMeta("/api/physician/transcription/associate-patient", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = auth.userId;
    const access = await assertPhysicianCanAccessPatient({
      physicianId,
      patientId: parsed.data.patientId,
      scope,
    });

    await updateEncounterPatient({
      encounterId: parsed.data.encounterId,
      patientId: parsed.data.patientId,
      physicianId,
      scope,
    });

    await logPhysicianPhiAudit({
      physicianId,
      patientId: parsed.data.patientId,
      encounterId: parsed.data.encounterId,
      soapVersionId: undefined,
      eventType: "transcription_patient_associated",
      ipAddress: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      metadata: { requestId },
    });

    const res = NextResponse.json({ success: true, patientName: access.patientName });
    logRequestMeta("/api/physician/transcription/associate-patient", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/transcription/associate-patient] failed:", error);
    const res = NextResponse.json({ error: "Failed to associate patient." }, { status });
    logRequestMeta("/api/physician/transcription/associate-patient", requestId, status, Date.now() - started);
    return res;
  }
}
