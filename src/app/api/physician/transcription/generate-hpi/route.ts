import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getAzureSoapClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { resolveWorkforceScope } from "@/lib/transcription-store";
import { generateHpiFromTranscriptRequestSchema } from "@/lib/transcription-schema";

const ROUTE = "/api/physician/transcription/generate-hpi";

// Mid-visit working note. Produced from the IN-PROGRESS transcript so the
// physician can gauge direction without stopping. Nothing is persisted.
const systemPrompt = `You are a clinical documentation assistant helping a physician during a live patient encounter.
You will receive an IN-PROGRESS transcript — the conversation so far, which may be incomplete.
From only what has been said, produce a concise preliminary working note. Do not invent facts; if a detail is missing, omit it.
When the transcript is in a non-English language, translate each symptom or complaint into its precise clinical English equivalent, and write the entire note in English.
Return plain text using EXACTLY these four labelled sections, in this order, each on its own line followed by its content:

HPI:
<one short "- " bulleted line per distinct clinical fact — chief complaint, onset/duration/severity/character, associated symptoms, aggravating/relieving factors, and any relevant history mentioned. Start each bullet directly with the clinical fact, never "Patient reports" or "She states." Omit filler negatives and anything not yet known.>

Likely diagnosis:
<the single most probable working diagnosis given the information so far>

Differential diagnosis:
<the other diagnoses worth considering, separated by semicolons>

Suggested plan:
<pragmatic next steps to consider — workup, treatment, or what to ask next — separated by semicolons>

This is a preliminary aid based on a partial conversation, not a final note. Do not add disclaimers, markdown, or extra sections.`;

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

    const azure = getAzureSoapClient();
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: parsed.data.transcript },
      ],
      max_completion_tokens: 900,
    });
    const choice = completion.choices?.[0];
    if (choice?.finish_reason === "content_filter") {
      status = 422;
      const res = NextResponse.json(
        { error: "The transcript was blocked by the content filter. Please review the content and try again." },
        { status },
      );
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
    if (apiStatus === 400) {
      const errBody = (error as Record<string, unknown>)?.error as Record<string, unknown> | undefined;
      const code = errBody?.code as string | undefined;
      const innerCode = (errBody?.innererror as Record<string, unknown>)?.code as string | undefined;
      const isContentFilter =
        code === "content_filter" ||
        innerCode === "ResponsibleAIPolicyViolation" ||
        (error instanceof Error && error.message.toLowerCase().includes("content_filter"));
      if (isContentFilter) {
        status = 422;
        console.warn("[physician/transcription/generate-hpi] Azure content filter blocked input:", error);
        const res = NextResponse.json(
          { error: "The transcript was blocked by the content filter. Please review the content and try again." },
          { status },
        );
        logRequestMeta(ROUTE, requestId, status, Date.now() - started);
        return res;
      }
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
