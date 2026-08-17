import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getAzureSoapClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { resolveWorkforceScope } from "@/lib/transcription-store";
import { generateHpiFromTranscriptRequestSchema } from "@/lib/transcription-schema";
import {
  buildContentFilterPayload,
  categoriesFromApiError,
  categoriesFromChoice,
  isContentFilterError,
} from "@/lib/content-filter";

const ROUTE = "/api/physician/transcription/generate-hpi";

// Mid-visit working note. Produced from the IN-PROGRESS transcript so the
// physician can gauge direction without stopping. Nothing is persisted.
const HPI_SECTION_BY_LEVEL: Record<1 | 2 | 3, string> = {
  1: `<one short "- " bulleted line per distinct clinical fact — chief complaint, onset/duration/severity/character, associated symptoms, aggravating/relieving factors, and any relevant history mentioned. Start each bullet directly with the clinical fact, never "Patient reports" or "She states." Omit filler negatives and anything not yet known.>`,
  2: `<one "- " bulleted line per clinical theme — chief complaint, onset/duration/severity/character, associated symptoms, aggravating/relieving factors, and any relevant history mentioned; combine tightly-related facts into one bullet when it reads naturally. Start each bullet directly with the clinical fact, never "Patient reports" or "She states." Favor completeness over trimming — keep a detail if it could matter, even if a bullet runs a bit longer.>`,
  3: `<a thorough history-of-present-illness paragraph — chief complaint, onset/duration/severity/character, associated symptoms, aggravating/relieving factors, relevant past medical history, current medications, allergies if mentioned, and any other relevant history mentioned. Completeness takes priority over brevity — do not omit a clinically relevant detail to save space.>`,
};

function buildSystemPrompt(level: unknown): string {
  const lvl = level === 1 || level === 2 || level === 3 ? level : 2;
  return `You are a clinical documentation assistant helping a physician during a live patient encounter.
You will receive an IN-PROGRESS transcript — the conversation so far, which may be incomplete.
From only what has been said, produce a concise preliminary working note. Do not invent facts; if a detail is missing, omit it.
When the transcript is in a non-English language, translate each symptom or complaint into its precise clinical English equivalent, and write the entire note in English.
Return plain text using EXACTLY these four labelled sections, in this order, each on its own line followed by its content:

HPI:
${HPI_SECTION_BY_LEVEL[lvl]}

Likely diagnosis:
<the single most probable working diagnosis given the information so far>

Differential diagnosis:
<the other diagnoses worth considering, separated by semicolons>

Suggested plan:
<pragmatic next steps to consider — workup, treatment, or what to ask next — separated by semicolons>

This is a preliminary aid based on a partial conversation, not a final note. Do not add disclaimers, markdown, or extra sections.`;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "HPI generation is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }

  // Kept outside try so the catch block can pinpoint content-filter blocks.
  let transcriptForFilter: string | null = null;

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
    const parsed = generateHpiFromTranscriptRequestSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid payload.", details: parsed.error.format() }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    transcriptForFilter = parsed.data.transcript;

    const azure = getAzureSoapClient();
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: buildSystemPrompt(parsed.data.detailLevel) },
        { role: "user", content: parsed.data.transcript },
      ],
      max_completion_tokens: 900,
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
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    const result = choice?.message?.content?.trim() || "";
    if (!result) {
      status = 422;
      const res = NextResponse.json(
        { error: "Not enough clinical content to generate an HPI yet. Keep transcribing and try again." },
        { status },
      );
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({ result });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    const isApiError = error instanceof Error && "status" in error;
    const apiStatus = isApiError ? (error as { status: number }).status : null;
    if (apiStatus === 429) {
      status = 429;
      console.error("[physician/transcription/generate-hpi] Azure OpenAI rate limit:", error);
      const res = NextResponse.json({ error: "AI service is busy. Please try again in a moment." }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    if (apiStatus === 400 && isContentFilterError(error)) {
      status = 422;
      console.error("[physician/transcription/generate-hpi] Azure content filter blocked input:", error);
      const azure = getAzureSoapClient();
      const payload = await buildContentFilterPayload({
        transcript: transcriptForFilter ?? "",
        categories: categoriesFromApiError(error),
        client: transcriptForFilter ? azure.client : undefined,
        deployment: azure.deployment,
      });
      const res = NextResponse.json(payload, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    if (apiStatus && apiStatus >= 500) {
      console.error("[physician/transcription/generate-hpi] Azure OpenAI service error:", error);
    } else {
      console.error("[physician/transcription/generate-hpi] failed:", error);
    }
    const res = NextResponse.json({ error: "Failed to generate HPI." }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }
}
