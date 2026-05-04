import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { logDebug } from "@/lib/secure-logger";
import { extractPdfText } from "@/lib/pdf-extract";

const MAX_SOAP_TEXT_LENGTH = 15000;
const MAX_PROMPT_LENGTH = 2000;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif",
]);
const ALLOWED_FILE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif",
  "application/pdf",
]);
const MAX_FILE_BASE64_LENGTH = 7_000_000; // ~5 MB raw

const systemPrompt = `You are a clinical assistant helping physicians with tasks related to a SOAP note.
- Use only the provided SOAP note as clinical context.
- Be concise, actionable, and avoid boilerplate.
- Do not invent data; if a detail is missing, omit it.
- Refer to the patient generically ("the patient"), avoid names and identifiers.
- No disclaimers.`;

const visionSystemPrompt = `You are a clinical assistant helping physicians. You will receive a SOAP note and a clinical image.
- Analyze the attached image carefully and describe the visible clinical findings (morphology, distribution, color, size, any notable features).
- Incorporate both the image findings and the SOAP note context into your response.
- Be concise, actionable, and clinically precise.
- Do not invent data; describe only what is visible.
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

  const { soapText, prompt, fileBase64, fileMimeType } = (body || {}) as {
    soapText?: string;
    prompt?: string;
    fileBase64?: string;
    fileMimeType?: string;
  };

  // Validate optional file attachment
  if (fileBase64 !== undefined) {
    if (typeof fileBase64 !== "string" || fileBase64.length > MAX_FILE_BASE64_LENGTH) {
      return NextResponse.json({ error: "File is too large (max 5 MB)." }, { status: 400 });
    }
    if (!fileMimeType || !ALLOWED_FILE_MIME_TYPES.has(fileMimeType)) {
      return NextResponse.json({ error: "Invalid file type. Supported: PNG, JPEG, WEBP, HEIC, HEIF, PDF." }, { status: 400 });
    }
  }

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

  const hasFile = typeof fileBase64 === "string" && fileBase64.length > 0;
  const isPdf = hasFile && fileMimeType === "application/pdf";
  const isImage = hasFile && !isPdf;

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Azure OpenAI is not configured." },
      { status: 500 }
    );
  }

  // For PDFs: extract text and include as additional context
  let pdfText: string | null = null;
  if (isPdf) {
    try {
      const buffer = Buffer.from(fileBase64!, "base64");
      pdfText = await extractPdfText(buffer) || null;
    } catch {
      return NextResponse.json({ error: "Could not read the PDF. Make sure it is a valid, text-based PDF." }, { status: 400 });
    }
    if (!pdfText) {
      return NextResponse.json({ error: "No text could be extracted from the PDF." }, { status: 400 });
    }
  }

  const activeSystemPrompt = isImage ? visionSystemPrompt : systemPrompt;

  function buildPromptWithFile(): string {
    const base = buildUserPrompt(soapText!, prompt!);
    if (!pdfText) return base;
    return `${base}\n\nAttached document (extracted text):\n${pdfText.slice(0, 8000)}`;
  }

  const userMessageContent = isImage
    ? [
        { type: "text" as const, text: buildUserPrompt(soapText!, prompt!) },
        { type: "image_url" as const, image_url: { url: `data:${fileMimeType};base64,${fileBase64}` } },
      ]
    : buildPromptWithFile();

  try {
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: activeSystemPrompt },
        { role: "user", content: userMessageContent as any },
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
