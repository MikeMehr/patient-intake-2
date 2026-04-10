import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import {
  assertPhysicianCanAccessPatient,
  createSoapDraftVersion,
  createTranscriptionEncounter,
  resolveWorkforceScope,
  upsertPatientFromQuickEntry,
  upsertTranscriptionSessionPointer,
} from "@/lib/transcription-store";
import { generateSoapFromTranscriptRequestSchema, soapDraftSchema } from "@/lib/transcription-schema";
import { parseJsonValue } from "@/lib/safe-json";
import { HEALTHASSIST_SNAPSHOT_LABEL } from "@/lib/transcription-policy";

const systemPrompt = `You are a clinical documentation assistant.
Analyze the physician-patient transcript and identify all distinct patient cases (separate patients or separate clinical encounters).
For EACH distinct case, create a concise SOAP note.
Return valid JSON only: an array of objects, each with keys: label, subjective, objective, assessment, plan.
- "label": brief case identifier (e.g. "Headache", "Left Elbow Pain")
- "subjective": patient symptoms, history, and relevant context
- "objective": exam findings and vitals (if documented)
- "assessment": likely diagnosis and differentials
- "plan": recommended investigations if appropriate, treatment, and follow-up
If there is only one case, still return a single-element array.
Do not include markdown, code fences, or extra keys.
Each field should be clinically useful and concise.`;

function buildPreview(subjective: string, assessment: string) {
  const text = `${subjective.trim()} ${assessment.trim()}`.trim();
  if (!text) return null;
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Transcription SOAP generation is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
      return res;
    }
    if (auth.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
      return res;
    }
    const scope = resolveWorkforceScope({
      userType: auth.userType,
      userId: getEffectivePhysicianId(auth),
      organizationId: auth.organizationId || null,
    });
    if (!scope) {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = generateSoapFromTranscriptRequestSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid payload.", details: parsed.error.format() }, { status });
      logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(auth);
    let patientId: string | null = parsed.data.patientId || null;
    let patientName: string | null = null;
    let identityPath: "existing_patient" | "new_patient_quick_entry" | "anonymous" = "anonymous";
    if (patientId) {
      const access = await assertPhysicianCanAccessPatient({
        physicianId,
        patientId,
        scope,
      });
      patientName = access.patientName;
      identityPath = "existing_patient";
    } else if (parsed.data.newPatient) {
      const created = await upsertPatientFromQuickEntry({
        physicianId,
        scope,
        fullName: parsed.data.newPatient.fullName,
        dateOfBirth: parsed.data.newPatient.dateOfBirth,
      });
      patientId = created.patientId;
      patientName = created.patientName;
      identityPath = "new_patient_quick_entry";
    }

    let encounterId = parsed.data.encounterId || "";
    if (!encounterId) {
      const encounter = await createTranscriptionEncounter({
        physicianId,
        patientId,
        scope,
        chiefComplaint: parsed.data.chiefComplaint || null,
      });
      encounterId = encounter.encounterId;
    }

    const azure = getAzureOpenAIClient();
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: parsed.data.transcript },
      ],
      max_completion_tokens: 3000,
    });
    const payload = completion.choices?.[0]?.message?.content?.trim() || "";
    let soapArray: Array<{ label: string; subjective: string; objective: string; assessment: string; plan: string }>;
    try {
      const rawParsed = parseJsonValue(payload, "SOAP model output");
      if (!Array.isArray(rawParsed)) {
        throw new Error("Model did not return an array.");
      }
      soapArray = rawParsed.map((item, i) => {
        const result = soapDraftSchema.safeParse(item);
        if (!result.success) throw new Error(`Case ${i + 1} has invalid SOAP schema.`);
        return {
          label: typeof item?.label === "string" && item.label.trim() ? item.label.trim() : `Case ${i + 1}`,
          ...result.data,
        };
      });
      if (soapArray.length === 0) throw new Error("Model returned empty array.");
    } catch {
      throw new Error("Model returned invalid SOAP JSON.");
    }

    // Create one encounter + SOAP version per case
    const caseResults: Array<{
      label: string;
      encounterId: string;
      soapVersionId: string;
      version: number;
      draft: { subjective: string; objective: string; assessment: string; plan: string };
    }> = [];

    for (let i = 0; i < soapArray.length; i++) {
      const soap = soapArray[i];
      // Use provided encounterId only for the first case when there is only one case
      let caseEncounterId = soapArray.length === 1 ? encounterId : "";
      if (!caseEncounterId) {
        const encounter = await createTranscriptionEncounter({
          physicianId,
          patientId,
          scope,
          chiefComplaint: soap.label || parsed.data.chiefComplaint || null,
        });
        caseEncounterId = encounter.encounterId;
      }

      const draft = {
        subjective: String(soap.subjective || "").trim(),
        objective: String(soap.objective || "").trim(),
        assessment: String(soap.assessment || "").trim(),
        plan: String(soap.plan || "").trim(),
      };

      const saved = await createSoapDraftVersion({
        encounterId: caseEncounterId,
        patientId,
        physicianId,
        draft,
        transcript: parsed.data.transcript,
      });
      await upsertTranscriptionSessionPointer({
        physicianId,
        patientId,
        encounterId: caseEncounterId,
        soapVersionId: saved.soapVersionId,
        previewSummary: buildPreview(String(soap.subjective || ""), String(soap.assessment || "")),
      });

      await logPhysicianPhiAudit({
        physicianId,
        patientId: patientId || undefined,
        encounterId: caseEncounterId,
        soapVersionId: saved.soapVersionId,
        eventType: "transcription_soap_generated",
        ipAddress: getRequestIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        metadata: {
          requestId,
          encounterId: caseEncounterId,
          version: saved.version,
          transcriptLength: parsed.data.transcript.length,
          identityPath,
          caseIndex: i,
          caseLabel: soap.label,
        },
      });

      caseResults.push({
        label: soap.label,
        encounterId: caseEncounterId,
        soapVersionId: saved.soapVersionId,
        version: saved.version,
        draft,
      });
    }

    const res = NextResponse.json({
      // Legacy single-case fields (first case) for backward compat
      encounterId: caseResults[0].encounterId,
      soapVersionId: caseResults[0].soapVersionId,
      version: caseResults[0].version,
      lifecycleState: "DRAFT",
      patientName,
      draft: caseResults[0].draft,
      snapshotLabel: HEALTHASSIST_SNAPSHOT_LABEL,
      // Multi-case array
      cases: caseResults.map((c) => ({
        label: c.label,
        encounterId: c.encounterId,
        soapVersionId: c.soapVersionId,
        version: c.version,
        lifecycleState: "DRAFT",
        draft: c.draft,
      })),
    });
    logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/transcription/generate] failed:", error);
    const res = NextResponse.json({ error: "Failed to generate SOAP note." }, { status });
    logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
    return res;
  }
}
