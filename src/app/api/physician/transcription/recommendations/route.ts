import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getAzureSoapClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { resolveWorkforceScope } from "@/lib/transcription-store";
import { transcriptionRecommendationsRequestSchema } from "@/lib/transcription-schema";
import { parseJsonValue } from "@/lib/safe-json";
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
Return valid JSON only: an object with EXACTLY these three string keys — labs, referrals, imaging.
- "labs": recommended blood work / diagnostics with a brief rationale for each (e.g. "Rheumatoid arthritis workup: RF, anti-CCP, ESR, CRP — r/o rheumatoid arthritis"). Empty string "" if no lab work is indicated.
- "referrals": for each specialist referral discussed, a concise referral note of 2-3 lines — reason for referral, pertinent positives/negatives, and urgency (e.g. "Referral to Gynecology. Reason: ... Pertinent findings: ... Urgency: routine"). Separate multiple referrals with a blank line. Empty string "" if no referral is indicated.
- "imaging": for each imaging need discussed, a requisition line — modality + body part followed by a 1-2 line clinical indication (e.g. "X-ray right knee — Two weeks of right knee pain, rule out arthritis"). Separate multiple studies with a blank line. Empty string "" if no imaging is indicated.
Do not include markdown, code fences, or extra keys.`;

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

    const azure = getAzureSoapClient();
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: systemPrompt },
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
    try {
      const rawParsed = parseJsonValue(payload, "recommendations model output") as Record<string, unknown>;
      if (!rawParsed || typeof rawParsed !== "object" || Array.isArray(rawParsed)) {
        throw new Error("Model did not return an object.");
      }
      labs = asString(rawParsed.labs);
      referrals = asString(rawParsed.referrals);
      imaging = asString(rawParsed.imaging);
    } catch {
      // Return empty recommendations rather than an error — this is a non-blocking
      // background enhancement; a parse miss simply shows no reveal buttons.
      const res = NextResponse.json({ labs: "", referrals: "", imaging: "" });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({ labs, referrals, imaging });
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
