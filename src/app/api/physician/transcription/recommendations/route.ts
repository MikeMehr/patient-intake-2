import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getAzureSoapClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { resolveWorkforceScope } from "@/lib/transcription-store";
import { transcriptionRecommendationsRequestSchema } from "@/lib/transcription-schema";
import { escapeRawNewlinesInJsonStrings, parseJsonValue } from "@/lib/safe-json";
import { formatStyleRulesAppendix, listStyleRuleTexts } from "@/lib/ai-style-rules";
import {
  buildContentFilterPayload,
  categoriesFromApiError,
  categoriesFromChoice,
  isContentFilterError,
} from "@/lib/content-filter";

const ROUTE = "/api/physician/transcription/recommendations";

// Extract the actionable follow-ups implied by the encounter so the physician
// can reveal them instantly in Review and export. Nothing is persisted.
const systemPrompt = `You are a clinical assistant. Analyze the physician-patient encounter transcript (and assessment, if provided) and extract the follow-up actions the encounter implies.
When the transcript is in a non-English language, translate the clinical content into English; write everything in English.
Only include items that were explicitly discussed, decided, or clearly indicated by the clinical picture — do not invent orders or referrals.
Use standard clinical abbreviations for lab/test names throughout (e.g. "LH", "FSH", "TSH", "RF") — never spell out the full name with the abbreviation in parentheses.
Return valid JSON only: an object with EXACTLY these four string keys — labs, referrals, imaging, medications.
- "labs": recommended blood work / diagnostics with a brief rationale for each. For a workup implied by the clinical picture, enumerate the full standard panel of individual analytes it entails rather than a single representative test — e.g. "Rheumatoid arthritis workup: RF, anti-CCP, ESR, CRP — r/o rheumatoid arthritis" or "Hypogonadism workup: total testosterone, free testosterone, LH, FSH, prolactin, SHBG — r/o primary vs secondary hypogonadism". Empty string "" if no lab work is indicated.
- "referrals": for each specialist referral discussed, a concise referral note of 2-3 lines — reason for referral, pertinent positives/negatives, and urgency (e.g. "Referral to Gynecology. Reason: ... Pertinent findings: ... Urgency: routine"). Separate multiple referrals with a blank line. Empty string "" if no referral is indicated.
- "imaging": for each imaging need discussed, a requisition line — modality + body part followed by a 1-2 line clinical indication (e.g. "X-ray right knee — Two weeks of right knee pain, rule out arthritis"). Separate multiple studies with a blank line. Empty string "" if no imaging is indicated.
- "medications": ONLY prescriptions the physician EXPLICITLY dictated as an order — drug name + dose + frequency at minimum, plus quantity/repeats when stated (e.g. "Naproxen 500 mg PO BID PRN pain, #40"). One per line. NEVER include medications that were merely mentioned, reviewed, continued without a new order, or implied by the clinical picture — do not invent prescriptions. Empty string "" if no prescription was dictated.
Do not include markdown, code fences, or extra keys.`;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Recommendations are disabled in HIPAA mode (external AI blocked)." },
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
    const parsed = transcriptionRecommendationsRequestSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid payload.", details: parsed.error.format() }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const userContent = parsed.data.assessment
      ? `Transcript:\n${parsed.data.transcript}\n\nAssessment:\n${parsed.data.assessment}`
      : `Transcript:\n${parsed.data.transcript}`;

    const physicianId = getEffectivePhysicianId(auth);
    const [imagingRules, referralRules] = await Promise.all([
      listStyleRuleTexts(physicianId, "recommendations_imaging"),
      listStyleRuleTexts(physicianId, "recommendations_referrals"),
    ]);
    let styledSystemPrompt = systemPrompt;
    if (imagingRules.length) {
      styledSystemPrompt += "\n\n" + formatStyleRulesAppendix(imagingRules, 'the "imaging" field');
    }
    if (referralRules.length) {
      styledSystemPrompt += "\n\n" + formatStyleRulesAppendix(referralRules, 'the "referrals" field');
    }

    const azure = getAzureSoapClient();
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: styledSystemPrompt },
        { role: "user", content: userContent },
      ],
      max_completion_tokens: 1500,
    });
    const choice = completion.choices?.[0];
    if (choice?.finish_reason === "content_filter") {
      status = 422;
      // Background enhancement — report categories but skip passage probing.
      const payload = await buildContentFilterPayload({
        transcript: parsed.data.transcript,
        categories: categoriesFromChoice(choice),
      });
      const res = NextResponse.json(payload, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    const rawContent = choice?.message?.content?.trim() || "";
    const stripped = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const payload = escapeRawNewlinesInJsonStrings(stripped);

    let labs = "";
    let referrals = "";
    let imaging = "";
    let medications = "";
    try {
      const rawParsed = parseJsonValue(payload, "recommendations model output") as Record<string, unknown>;
      if (!rawParsed || typeof rawParsed !== "object" || Array.isArray(rawParsed)) {
        throw new Error("Model did not return an object.");
      }
      labs = asString(rawParsed.labs);
      referrals = asString(rawParsed.referrals);
      imaging = asString(rawParsed.imaging);
      medications = asString(rawParsed.medications);
    } catch {
      // Return empty recommendations rather than an error — this is a non-blocking
      // background enhancement; a parse miss simply shows no reveal buttons.
      const res = NextResponse.json({ labs: "", referrals: "", imaging: "", medications: "" });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({ labs, referrals, imaging, medications });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    const isApiError = error instanceof Error && "status" in error;
    const apiStatus = isApiError ? (error as { status: number }).status : null;
    if (apiStatus === 429) {
      status = 429;
      console.error("[physician/transcription/recommendations] Azure OpenAI rate limit:", error);
      const res = NextResponse.json({ error: "AI service is busy. Please try again in a moment." }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    if (apiStatus === 400 && isContentFilterError(error)) {
      status = 422;
      console.error("[physician/transcription/recommendations] Azure content filter blocked input:", error);
      // Background enhancement — report categories but skip passage probing.
      const payload = await buildContentFilterPayload({
        transcript: "",
        categories: categoriesFromApiError(error),
      });
      const res = NextResponse.json(payload, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    if (apiStatus && apiStatus >= 500) {
      console.error("[physician/transcription/recommendations] Azure OpenAI service error:", error);
    } else {
      console.error("[physician/transcription/recommendations] failed:", error);
    }
    const res = NextResponse.json({ error: "Failed to generate recommendations." }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }
}
