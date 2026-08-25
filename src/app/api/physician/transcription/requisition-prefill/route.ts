import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getAzureSoapClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { resolveWorkforceScope } from "@/lib/transcription-store";
import { requisitionPrefillRequestSchema } from "@/lib/transcription-schema";
import { escapeRawNewlinesInJsonStrings, parseJsonValue } from "@/lib/safe-json";
import { clampFillSpec } from "@/lib/oscar/eform-prefill";
import {
  buildImagingFillSpec,
  buildLabsFillSpec,
  buildReferralFillSpecs,
  type ImagingExtraction,
  type ImagingModality,
  type ImagingStudy,
  type LabsExtraction,
  type ReferralExtraction,
  type ReferralItem,
} from "@/lib/oscar/eform-prefill-maps";
import {
  buildContentFilterPayload,
  categoriesFromApiError,
  categoriesFromChoice,
  isContentFilterError,
} from "@/lib/content-filter";

const ROUTE = "/api/physician/transcription/requisition-prefill";

// Turns the free-text recommendation into a structured order so the OSCAR
// eForm (imaging fid=7 / labs fid=3) can be opened prefilled. Unlike the
// recommendations route this is user-initiated, so failures surface as errors
// instead of silently returning empty. Nothing is persisted.

const imagingSystemPrompt = `You extract imaging orders from a physician's recommended-imaging text (and assessment, if provided).
Return valid JSON only, exactly: {"studies": [{"modality": "xray"|"ct"|"ultrasound"|"doppler"|"other", "bodyPart": string, "side": "left"|"right"|"bilateral"|null}], "relevantHistory": string, "reasonForExam": string}.
- One entry per distinct study stated in the text. Never invent studies not present in the text.
- "bodyPart": the anatomical region as written (e.g. "knee", "abdomen", "chest"). Do not include the side in bodyPart.
- "side": only when explicitly stated; otherwise null.
- "relevantHistory": 1-3 lines of pertinent clinical history drawn from the text/assessment (mechanism, duration, key findings).
- "reasonForExam": 1-2 lines stating what each study should assess or rule out.
- Write everything in English; use standard clinical abbreviations. No markdown, no code fences, no extra keys.`;

const labsSystemPrompt = `You extract lab orders from a physician's recommended-labs text (and assessment, if provided).
Return valid JSON only, exactly: {"tests": string[], "indication": string, "subject": string}.
- "tests": every individual analyte stated in the text, one entry each, using standard abbreviations (e.g. "CBC", "TSH", "anti-CCP"). Split named panels into their individual analytes when the text enumerates them. Never invent tests not present in the text.
- "indication": a 1-2 line clinical indication combining the rationales given (e.g. "Joint pain, r/o rheumatoid arthritis").
- "subject": a summary line of at most 60 characters (e.g. "Bloodwork - RA workup").
- Write everything in English. No markdown, no code fences, no extra keys.`;

const referralSystemPrompt = `You extract specialist referrals from a physician's referral-recommendations text (and assessment, if provided).
Return valid JSON only, exactly: {"referrals": [{"service": string, "urgency": "routine"|"urgent", "reason": string, "clinicalInformation": string}]}.
- One entry per distinct referral stated in the text. Never invent referrals not present in the text.
- "service": the specialty as a plain noun matching a clinic directory entry (e.g. "Dermatology", "Orthopedics", "Gynecology") — no "Dr.", no "referral to".
- "urgency": "urgent" only when the text says so; otherwise "routine".
- "reason": a 1-3 line reason for consultation addressed to the specialist (e.g. "Thank you for seeing this patient. Evaluate ...").
- "clinicalInformation": 1-3 lines of pertinent positives/negatives and relevant history drawn from the text/assessment; empty string if none given.
- Write everything in English; use standard clinical abbreviations. No markdown, no code fences, no extra keys.`;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const MODALITIES: ImagingModality[] = ["xray", "ct", "ultrasound", "doppler", "other"];

function parseImagingExtraction(raw: unknown): ImagingExtraction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const studiesRaw = Array.isArray(record.studies) ? record.studies : [];
  const studies: ImagingStudy[] = [];
  for (const entry of studiesRaw) {
    if (!entry || typeof entry !== "object") continue;
    const study = entry as Record<string, unknown>;
    const modality = asString(study.modality).toLowerCase();
    const bodyPart = asString(study.bodyPart);
    const side = asString(study.side).toLowerCase();
    if (!MODALITIES.includes(modality as ImagingModality)) continue;
    if (!bodyPart) continue;
    studies.push({
      modality: modality as ImagingModality,
      bodyPart,
      side: side === "left" || side === "right" || side === "bilateral" ? side : null,
    });
  }
  if (studies.length === 0) return null;
  return {
    studies,
    relevantHistory: asString(record.relevantHistory),
    reasonForExam: asString(record.reasonForExam),
  };
}

function parseLabsExtraction(raw: unknown): LabsExtraction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const tests = (Array.isArray(record.tests) ? record.tests : [])
    .map(asString)
    .filter(Boolean);
  if (tests.length === 0) return null;
  return {
    tests,
    indication: asString(record.indication),
    subject: asString(record.subject),
  };
}

function parseReferralExtraction(raw: unknown): ReferralExtraction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const referralsRaw = Array.isArray(record.referrals) ? record.referrals : [];
  const referrals: ReferralItem[] = [];
  for (const entry of referralsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const referral = entry as Record<string, unknown>;
    const service = asString(referral.service);
    const reason = asString(referral.reason);
    if (!service && !reason) continue;
    referrals.push({
      service,
      urgency: asString(referral.urgency).toLowerCase() === "urgent" ? "urgent" : "routine",
      reason,
      clinicalInformation: asString(referral.clinicalInformation),
    });
  }
  if (referrals.length === 0) return null;
  return { referrals };
}

const SYSTEM_PROMPTS = {
  imaging: imagingSystemPrompt,
  labs: labsSystemPrompt,
  referral: referralSystemPrompt,
} as const;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Requisition prefill is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }

  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    if (auth.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
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
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = requisitionPrefillRequestSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid payload.", details: parsed.error.format() }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    const { type, recommendationText, assessment, demographicNo } = parsed.data;

    const userContent = assessment
      ? `Recommendation:\n${recommendationText}\n\nAssessment:\n${assessment}`
      : `Recommendation:\n${recommendationText}`;

    const azure = getAzureSoapClient();
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: SYSTEM_PROMPTS[type] },
        { role: "user", content: userContent },
      ],
      max_completion_tokens: 800,
    });
    const choice = completion.choices?.[0];
    if (choice?.finish_reason === "content_filter") {
      status = 422;
      const payload = await buildContentFilterPayload({
        transcript: recommendationText,
        categories: categoriesFromChoice(choice),
      });
      const res = NextResponse.json(payload, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    const rawContent = choice?.message?.content?.trim() || "";
    const stripped = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

    let extractedRaw: unknown = null;
    try {
      extractedRaw = parseJsonValue(
        escapeRawNewlinesInJsonStrings(stripped),
        "requisition prefill model output",
      );
    } catch {
      extractedRaw = null;
    }

    if (type === "referral") {
      const extraction = parseReferralExtraction(extractedRaw);
      if (!extraction) {
        status = 422;
        const res = NextResponse.json(
          { error: "Could not extract any referrals from this recommendation. Please fill the form manually." },
          { status },
        );
        logRequestMeta(ROUTE, requestId, status, Date.now() - started);
        return res;
      }
      const { specs, summary } = buildReferralFillSpecs(extraction, demographicNo);
      let truncated = false;
      const clampedSpecs = specs.map((s) => {
        const clamped = clampFillSpec(s);
        truncated = truncated || clamped.truncated;
        return clamped.spec;
      });
      const res = NextResponse.json({ specs: clampedSpecs, truncated, summary });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    let result;
    if (type === "imaging") {
      const extraction = parseImagingExtraction(extractedRaw);
      if (!extraction) {
        status = 422;
        const res = NextResponse.json(
          { error: "Could not extract any imaging studies from this recommendation. Please fill the form manually." },
          { status },
        );
        logRequestMeta(ROUTE, requestId, status, Date.now() - started);
        return res;
      }
      result = buildImagingFillSpec(extraction, demographicNo);
    } else {
      const extraction = parseLabsExtraction(extractedRaw);
      if (!extraction) {
        status = 422;
        const res = NextResponse.json(
          { error: "Could not extract any lab tests from this recommendation. Please fill the form manually." },
          { status },
        );
        logRequestMeta(ROUTE, requestId, status, Date.now() - started);
        return res;
      }
      result = buildLabsFillSpec(extraction, demographicNo);
    }

    const { spec, truncated } = clampFillSpec(result.spec);
    const res = NextResponse.json({ spec, truncated, summary: result.summary });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    const isApiError = error instanceof Error && "status" in error;
    const apiStatus = isApiError ? (error as { status: number }).status : null;
    if (apiStatus === 429) {
      status = 429;
      console.error("[physician/transcription/requisition-prefill] Azure OpenAI rate limit:", error);
      const res = NextResponse.json({ error: "AI service is busy. Please try again in a moment." }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    if (apiStatus === 400 && isContentFilterError(error)) {
      status = 422;
      console.error("[physician/transcription/requisition-prefill] Azure content filter blocked input:", error);
      const payload = await buildContentFilterPayload({
        transcript: "",
        categories: categoriesFromApiError(error),
      });
      const res = NextResponse.json(payload, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    if (apiStatus && apiStatus >= 500) {
      console.error("[physician/transcription/requisition-prefill] Azure OpenAI service error:", error);
    } else {
      console.error("[physician/transcription/requisition-prefill] failed:", error);
    }
    const res = NextResponse.json({ error: "Failed to prepare the requisition." }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }
}
