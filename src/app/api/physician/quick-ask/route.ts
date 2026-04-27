import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { logDebug } from "@/lib/secure-logger";

const MAX_PROMPT_LENGTH = 2000;
const ROUTE = "/api/physician/quick-ask";

const systemPrompt = `You are a helpful medical AI assistant for physicians. Answer medical questions clearly, concisely, and accurately. Do not provide diagnoses for specific patients. No disclaimers.`;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "AI actions are disabled in HIPAA mode (external AI blocked)." },
      { status }
    );
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }

  const { prompt } = (body || {}) as { prompt?: string };

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    status = 400;
    const res = NextResponse.json({ error: "prompt is required." }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    status = 400;
    const res = NextResponse.json(
      { error: `prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.` },
      { status }
    );
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }

  const session = await getCurrentSession();
  if (!session) {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required" }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }

  if (session.userType !== "provider") {
    status = 403;
    const res = NextResponse.json({ error: "Only providers can use AI actions" }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Azure OpenAI is not configured." },
      { status: 500 }
    );
  }

  try {
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt.trim() },
      ],
      temperature: 1,
      max_completion_tokens: 800,
    });

    const result = completion.choices?.[0]?.message?.content?.trim() || "";
    if (!result) {
      throw new Error("No content returned from Azure OpenAI.");
    }

    const res = NextResponse.json({ result });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[quick-ask] AI generation failed:", errorMessage);
    logDebug("[quick-ask] Error details", { errorMessage });
    status = 502;
    const res = NextResponse.json(
      {
        error: "Unable to generate response right now.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status }
    );
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }
}
