import { NextRequest, NextResponse } from "next/server";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const supportedLanguages: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  zh: "Chinese (Simplified)",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  fa: "Farsi (Persian)",
};

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Translation is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  let payload: { text?: string; language?: string } = {};
  try {
    payload = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const languageCode =
    typeof payload.language === "string"
      ? payload.language.trim().toLowerCase()
      : "";

  if (!text) {
    status = 400;
    const res = NextResponse.json({ error: "text is required." }, { status });
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  if (!languageCode || !supportedLanguages[languageCode]) {
    status = 400;
    const res = NextResponse.json(
      { error: "Unsupported or missing language." },
      { status },
    );
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  if (languageCode === "en") {
    const res = NextResponse.json({ translation: text });
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    status = 500;
    const res = NextResponse.json(
      { error: "Azure OpenAI is not configured." },
      { status },
    );
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const languageName = supportedLanguages[languageCode];
    const instruction = `You are a medical translation assistant. Translate the patient's message into ${languageName}. Return only the translated text in ${languageName}. Preserve medical meaning and keep it concise.`;
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: text },
      ],
      max_completion_tokens: 600,
    });

    const translation =
      completion.choices?.[0]?.message?.content?.trim() || text;

    const res = NextResponse.json({ translation });
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 502;
    console.error("[translate] failed:", error);
    const res = NextResponse.json(
      { error: "Failed to translate text." },
      { status },
    );
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }
}
