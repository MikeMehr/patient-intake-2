import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import {
  assertPhysicianCanAccessPatient,
  createSoapDraftVersion,
  createTranscriptionEncounter,
  resolveScopeForPhysician,
  upsertTranscriptionSessionPointer,
} from "@/lib/transcription-store";
import { generateSoapFromTranscriptRequestSchema } from "@/lib/transcription-schema";
import { HEALTHASSIST_SNAPSHOT_LABEL } from "@/lib/transcription-policy";

const systemPrompt = `You are a clinical documentation assistant.
Create a concise SOAP note from the physician-patient transcript.
Return valid JSON only with keys: subjective, objective, assessment, plan.
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

    const body = await request.json().catch(() => null);
    const parsed = generateSoapFromTranscriptRequestSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid payload.", details: parsed.error.format() }, { status });
      logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = (auth as any).physicianId || auth.userId;
    const scope = await resolveScopeForPhysician(physicianId);
    const { patientName } = await assertPhysicianCanAccessPatient({
      physicianId,
      patientId: parsed.data.patientId,
      scope,
    });

    let encounterId = parsed.data.encounterId || "";
    if (!encounterId) {
      const encounter = await createTranscriptionEncounter({
        physicianId,
        patientId: parsed.data.patientId,
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
      max_completion_tokens: 1200,
    });
    const payload = completion.choices?.[0]?.message?.content?.trim() || "";
    let soap: { subjective: string; objective: string; assessment: string; plan: string };
    try {
      soap = JSON.parse(payload);
    } catch {
      throw new Error("Model returned invalid SOAP JSON.");
    }

    const saved = await createSoapDraftVersion({
      encounterId,
      patientId: parsed.data.patientId,
      physicianId,
      draft: {
        subjective: String(soap.subjective || "").trim(),
        objective: String(soap.objective || "").trim(),
        assessment: String(soap.assessment || "").trim(),
        plan: String(soap.plan || "").trim(),
      },
      transcript: parsed.data.transcript,
    });
    await upsertTranscriptionSessionPointer({
      physicianId,
      patientId: parsed.data.patientId,
      encounterId,
      soapVersionId: saved.soapVersionId,
      previewSummary: buildPreview(String(soap.subjective || ""), String(soap.assessment || "")),
    });

    await logPhysicianPhiAudit({
      physicianId,
      patientId: parsed.data.patientId,
      encounterId,
      soapVersionId: saved.soapVersionId,
      eventType: "transcription_soap_generated",
      ipAddress: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        requestId,
        encounterId,
        version: saved.version,
        transcriptLength: parsed.data.transcript.length,
      },
    });

    const res = NextResponse.json({
      encounterId,
      soapVersionId: saved.soapVersionId,
      version: saved.version,
      lifecycleState: "DRAFT",
      patientName,
      draft: {
        subjective: soap.subjective || "",
        objective: soap.objective || "",
        assessment: soap.assessment || "",
        plan: soap.plan || "",
      },
      snapshotLabel: HEALTHASSIST_SNAPSHOT_LABEL,
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
