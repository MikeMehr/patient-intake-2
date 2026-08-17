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
import {
  buildContentFilterPayload,
  categoriesFromApiError,
  categoriesFromChoice,
  isContentFilterError,
} from "@/lib/content-filter";
import { parseJsonValue } from "@/lib/safe-json";
import { HEALTHASSIST_SNAPSHOT_LABEL } from "@/lib/transcription-policy";

const SYSTEM_PROMPT_BY_LEVEL: Record<1 | 2 | 3, string> = {
  // Level 1: concise, point-form — one short clinical-fact sentence per field per bullet.
  1: `You are a clinical documentation assistant.
Analyze the physician-patient transcript and identify all distinct patient cases (separate patients or separate clinical encounters).
For EACH distinct case, create a concise, point-form SOAP note that a physician can scan in seconds — not a narrative summary.
Return valid JSON only: an array of objects, each with keys: label, subjective, objective, assessment, plan.
- "label": brief case identifier (e.g. "Headache", "Left Elbow Pain")
- "subjective": one short sentence per distinct clinical fact — chief complaint, onset/duration/severity/character, associated symptoms, aggravating and relieving factors, relevant past medical history, current medications and recent changes, allergies if mentioned, family history, social history, and any other clinically relevant details the patient reported. Exclude administrative details such as greetings, caller introductions, who called whom, office identification, and pharmacy/logistics coordination.
- "objective": one short sentence per exam finding or vital actually documented; leave blank if nothing was examined. Do not restate facts already covered in Subjective.
- "assessment": one short sentence for the working diagnosis, then — only if genuinely useful — one more sentence for the differential (e.g. "DDx: ..."). Start each directly with the clinical content.
- "plan": one dense sentence of terse, telegraphic actions separated by semicolons — drug name + dose/route/frequency/duration, tests ordered, referrals, follow-up timing. Omit filler verbs ("prescribe", "recommend", "suggest", "advise") and pure logistics (which pharmacy, who picks up a requisition) unless clinically necessary. Only include what was explicitly discussed or decided in the transcript.
Style rules for every field:
- Start each sentence directly with the clinical fact — never lead with "Patient reports", "She states", "He notes", or similar throat-clearing.
- One clinical point per sentence, each ending in a period — this is what turns into one bullet per line downstream, so never chain multiple facts into one long compound sentence.
- Drop statements that add no clinical value: filler like "no other history was discussed," and anything already stated elsewhere in the note. Keep pertinent negatives that affect the differential (e.g. "denies fever").
- Standard clinical abbreviations are fine (DDx, HTN, PMH, GP, f/u, etc.).
If there is only one case, still return a single-element array.
Do not include markdown, code fences, or extra keys.
CRITICAL JSON RULE: Every field value must be plain text on a single line. Do NOT literally type bullet characters or line breaks (\\n) inside any string value — literal newline characters inside JSON strings produce invalid JSON and will cause an error. Separate sentences with a single space only; the app renders each sentence as its own bullet automatically.
IMPORTANT: Always write the SOAP note entirely in English, regardless of the language used in the transcript.`,

  // Level 2: balanced — concise but flowing sentences, comprehensive subjective, don't trim detail just to save space.
  2: `You are a clinical documentation assistant.
Analyze the physician-patient transcript and identify all distinct patient cases (separate patients or separate clinical encounters).
For EACH distinct case, create a concise SOAP note — complete enough that nothing clinically important is lost, but without padding.
Return valid JSON only: an array of objects, each with keys: label, subjective, objective, assessment, plan.
- "label": brief case identifier (e.g. "Headache", "Left Elbow Pain")
- "subjective": comprehensive patient history including chief complaint, symptom onset/duration/severity/character, associated symptoms, aggravating and relieving factors, relevant past medical history, current medications and recent changes, allergies if mentioned, family history, social history, and any other clinically relevant details the patient reported — exclude administrative details such as greetings, caller introductions, who called whom, office identification, and pharmacy/logistics coordination
- "objective": exam findings and vitals (if documented)
- "assessment": diagnosis and clinically meaningful differentials, telegraphic but complete (e.g. "migraine; r/o secondary headache given nocturnal pattern and family history of brain tumors")
- "plan": telegraphic actions — use short phrases separated by semicolons; omit filler words like "prescribe", "recommend", "suggest", "advise"; use drug-name + route/frequency format (e.g. "clobetasol cream daily; Cetaphil prn; avoid irritants; f/u 4 wks"); only include what was explicitly discussed or decided in the transcript
If there is only one case, still return a single-element array.
Do not include markdown, code fences, or extra keys.
Each field should be clinically useful and concise, but do not omit a detail just to save space — favor completeness over brevity when the two conflict.
CRITICAL JSON RULE: Every field value must be plain prose on a single line. Do NOT use bullet points, numbered lists, or any line breaks (\\n) inside any string value. Literal newline characters inside JSON strings produce invalid JSON and will cause an error. Write all content as flowing sentences separated by spaces or semicolons.
IMPORTANT: Always write the SOAP note entirely in English, regardless of the language used in the transcript.`,

  // Level 3: max detail — thorough, completeness-over-brevity, non-English clinical-term mapping.
  3: `You are a clinical documentation assistant.
Analyze the physician-patient transcript and identify all distinct patient cases (separate patients or separate clinical encounters).
For EACH distinct case, create a thorough SOAP note. Completeness takes priority over brevity — never omit clinically significant findings, red flags, or urgent context to save space.
When the transcript is in a non-English language, first mentally translate each symptom or complaint into its precise clinical English equivalent before writing any field. Colloquial or culturally specific descriptions of bodily sensations must be mapped to standard clinical terminology (e.g. heat waves / sweating episodes → hot flashes / diaphoresis; racing heart → palpitations; feeling cold → chills). Then use those clinical terms to drive the diagnosis in the assessment field.
Return valid JSON only: an array of objects, each with keys: label, subjective, objective, assessment, plan.
- "label": brief case identifier (e.g. "Headache", "Left Elbow Pain")
- "subjective": comprehensive patient history including chief complaint, symptom onset/duration/severity/character, associated symptoms, aggravating and relieving factors, relevant past medical history, current medications and recent changes, allergies if mentioned, family history, social history, and any other clinically relevant details the patient reported — exclude administrative details such as greetings, caller introductions, who called whom, office identification, and pharmacy/logistics coordination
- "objective": exam findings and vitals (if documented)
- "assessment": diagnosis and clinically meaningful differentials; include the reasoning when the clinical picture is complex or urgent (e.g. "migraine; r/o secondary headache given known intracranial mass, nocturnal pattern, and family history of brain tumors")
- "plan": telegraphic actions — use 2–5 word phrases separated by semicolons; omit filler words like "prescribe", "recommend", "suggest", "advise"; use drug-name + route/frequency format (e.g. "clobetasol cream daily; Cetaphil prn; avoid irritants; f/u 4 wks"); only include what was explicitly discussed or decided in the transcript
If there is only one case, still return a single-element array.
Do not include markdown, code fences, or extra keys.
CRITICAL JSON RULE: Every field value must be plain prose on a single line. Do NOT use bullet points, numbered lists, or any line breaks (\\n) inside any string value. Literal newline characters inside JSON strings produce invalid JSON and will cause an error. Write all content as flowing sentences separated by spaces or semicolons.
IMPORTANT: Always write the SOAP note entirely in English, regardless of the language used in the transcript.`,
};

function resolveSystemPrompt(level: unknown): string {
  const lvl = level === 1 || level === 2 || level === 3 ? level : 2;
  return SYSTEM_PROMPT_BY_LEVEL[lvl];
}

/**
 * Escapes unescaped newlines/carriage-returns that appear inside JSON string
 * values. Models sometimes emit literal line-breaks in strings, which is
 * invalid JSON and causes JSON.parse to throw.
 */
function escapeRawNewlinesInJsonStrings(raw: string): string {
  let inString = false;
  let result = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\") {
        result += ch + (raw[i + 1] ?? "");
        i += 2;
        continue;
      } else if (ch === '"') {
        inString = false;
        result += ch;
      } else if (ch === "\n") {
        result += "\\n";
      } else if (ch === "\r") {
        result += "\\r";
      } else {
        result += ch;
      }
    } else {
      if (ch === '"') inString = true;
      result += ch;
    }
    i++;
  }
  return result;
}

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

  // Kept outside try so the catch block can pinpoint content-filter blocks.
  let transcriptForFilter: string | null = null;

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

    transcriptForFilter = parsed.data.transcript;

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
        { role: "system", content: resolveSystemPrompt(parsed.data.detailLevel) },
        { role: "user", content: parsed.data.transcript },
      ],
      max_completion_tokens: 3000,
    });
    const choice = completion.choices?.[0];
    if (choice?.finish_reason === "content_filter") {
      status = 422;
      const payload = await buildContentFilterPayload({
        transcript: parsed.data.transcript,
        categories: categoriesFromChoice(choice),
        client: azure.client,
        deployment: azure.deployment,
      });
      const res = NextResponse.json(payload, { status });
      logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
      return res;
    }
    const rawContent = choice?.message?.content?.trim() || "";
    // Strip markdown code fences the model occasionally emits despite the prompt
    const stripped = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    // Escape any literal newlines inside JSON string values (model sometimes emits them)
    const payload = escapeRawNewlinesInJsonStrings(stripped);
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
      status = 422;
      const res = NextResponse.json(
        { error: "Not enough clinical content to generate a SOAP note. Please add more detail to the transcript." },
        { status },
      );
      logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
      return res;
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

    // One session pointer for the entire batch, linking all case soap IDs
    await upsertTranscriptionSessionPointer({
      physicianId,
      patientId,
      encounterId: caseResults[0].encounterId,
      soapVersionId: caseResults[0].soapVersionId,
      previewSummary: buildPreview(String(soapArray[0].subjective || ""), String(soapArray[0].assessment || "")),
      caseSoapIds: caseResults.length > 1 ? caseResults.map((c) => c.soapVersionId) : undefined,
    });

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
    // Differentiate Azure OpenAI API errors from internal errors for better debugging
    const isApiError = error instanceof Error && "status" in error;
    const apiStatus = isApiError ? (error as { status: number }).status : null;
    if (apiStatus === 429) {
      status = 429;
      console.error("[physician/transcription/generate] Azure OpenAI rate limit:", error);
      const res = NextResponse.json({ error: "AI service is busy. Please try again in a moment." }, { status });
      logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
      return res;
    }
    if (apiStatus === 400 && isContentFilterError(error)) {
      status = 422;
      console.error("[physician/transcription/generate] Azure content filter blocked input:", error);
      const azure = getAzureOpenAIClient();
      const payload = await buildContentFilterPayload({
        transcript: transcriptForFilter ?? "",
        categories: categoriesFromApiError(error),
        client: transcriptForFilter ? azure.client : undefined,
        deployment: azure.deployment,
      });
      const res = NextResponse.json(payload, { status });
      logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
      return res;
    }
    if (apiStatus && apiStatus >= 500) {
      console.error("[physician/transcription/generate] Azure OpenAI service error:", error);
    } else {
      console.error("[physician/transcription/generate] failed:", error);
    }
    const res = NextResponse.json({ error: "Failed to generate SOAP note." }, { status });
    logRequestMeta("/api/physician/transcription/generate", requestId, status, Date.now() - started);
    return res;
  }
}
