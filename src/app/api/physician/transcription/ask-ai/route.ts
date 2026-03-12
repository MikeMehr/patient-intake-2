import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { logDebug } from "@/lib/secure-logger";

const MAX_SOAP_TEXT_LENGTH = 15000;
const MAX_PROMPT_LENGTH = 2000;

const systemPrompt = `You are a clinical assistant helping physicians with tasks related to a SOAP note.
- Use only the provided SOAP note as clinical context.
- Be concise, actionable, and avoid boilerplate.
- Do not invent data; if a detail is missing, omit it.
- Refer to the patient generically ("the patient"), avoid names and identifiers.
- No disclaimers.`;

function buildUserPrompt(soapText: string, prompt: string): string {
  return `SOAP Note:\n${soapText}\n\nPhysician request:\n${prompt}`;
}

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
    logRequestMeta("/api/physician/transcription/ask-ai", requestId, status, Date.now() - started);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json(
      { error: "Invalid JSON body." },
      { status }
    );
    logRequestMeta("/api/physician/transcription/ask-ai", requestId, status, Date.now() - started);
    return res;
  }

  const { soapText, prompt } = (body || {}) as {
    soapText?: string;
    prompt?: string;
  };

  if (!soapText || typeof soapText !== "string") {
    status = 400;
    const res = NextResponse.json(
      { error: "soapText is required." },
      { status }
    );
    logRequestMeta("/api/physician/transcription/ask-ai", requestId, status, Date.now() - started);
    return res;
  }

  if (soapText.length > MAX_SOAP_TEXT_LENGTH) {
    status = 400;
    const res = NextResponse.json(
      { error: `soapText must be ${MAX_SOAP_TEXT_LENGTH} characters or fewer.` },
      { status }
    );
    logRequestMeta("/api/physician/transcription/ask-ai", requestId, status, Date.now() - started);
    return res;
  }

  if (!prompt || typeof prompt !== "string") {
    status = 400;
    const res = NextResponse.json(
      { error: "prompt is required." },
      { status }
    );
    logRequestMeta("/api/physician/transcription/ask-ai", requestId, status, Date.now() - started);
    return res;
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    status = 400;
    const res = NextResponse.json(
      { error: `prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.` },
      { status }
    );
    logRequestMeta("/api/physician/transcription/ask-ai", requestId, status, Date.now() - started);
    return res;
  }

  const session = await getCurrentSession();
  if (!session) {
    status = 401;
    const res = NextResponse.json(
      { error: "Authentication required" },
      { status }
    );
    logRequestMeta("/api/physician/transcription/ask-ai", requestId, status, Date.now() - started);
    return res;
  }

  if (session.userType !== "provider") {
    status = 403;
    const res = NextResponse.json(
      { error: "Only providers can use AI actions" },
      { status }
    );
    logRequestMeta("/api/physician/transcription/ask-ai", requestId, status, Date.now() - started);
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
        { role: "user", content: buildUserPrompt(soapText, prompt) },
      ],
      temperature: 1,
      max_completion_tokens: 800,
    });

    const result = completion.choices?.[0]?.message?.content?.trim() || "";
    if (!result) {
      throw new Error("No content returned from Azure OpenAI.");
    }

    const res = NextResponse.json({ result });
    logRequestMeta("/api/physician/transcription/ask-ai", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[transcription/ask-ai] AI generation failed:", errorMessage);
    logDebug("[transcription/ask-ai] Error details", { errorMessage });
    status = 502;
    const res = NextResponse.json(
      {
        error: "Unable to generate response right now.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status }
    );
    logRequestMeta("/api/physician/transcription/ask-ai", requestId, status, Date.now() - started);
    return res;
  }
}
