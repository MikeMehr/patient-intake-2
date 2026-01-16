import { NextRequest, NextResponse } from "next/server";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const body = await request.json();
    const { text, language } = body ?? {};

    if (!text || typeof text !== "string") {
      status = 400;
      const res = NextResponse.json({ error: "text is required" }, { status });
      logRequestMeta("/api/speech/clean", requestId, status, Date.now() - started);
      return res;
    }

    const langName = typeof language === "string" && language.trim().length > 0 ? language.trim() : "English";
    const instruction = `You are a medical transcription cleanup assistant. The user provided a short, already speech-recognized utterance. Clean it up: fix recognition errors, normalize capitalization, and add appropriate sentence-ending punctuation if missing. Keep it concise, and keep the same language (${langName}). Do NOT add commentary, just return the corrected text.`;

    let azure;
    try {
      azure = getAzureOpenAIClient();
    } catch (err) {
      status = 500;
      const res = NextResponse.json({ error: "Azure OpenAI is not configured." }, { status });
      logRequestMeta("/api/speech/clean", requestId, status, Date.now() - started);
      return res;
    }

    try {
      const completion = await azure.client.chat.completions.create({
        model: azure.deployment,
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: text },
        ],
        max_completion_tokens: 120,
      });

      const cleaned = completion.choices?.[0]?.message?.content?.trim() || text;
      const res = NextResponse.json({ cleaned });
      logRequestMeta("/api/speech/clean", requestId, status, Date.now() - started);
      return res;
    } catch (err: any) {
      // If Azure content filters or other errors block, fall back to raw text to avoid 500s
      const code = err?.code || err?.error?.code;
      const isContentFilter = code === "content_filter";
      console.error("[speech/clean] generation failed, falling back to raw", { code, message: err?.message });
      const res = NextResponse.json({ cleaned: text, fallback: true, reason: isContentFilter ? "content_filter" : "error" });
      logRequestMeta("/api/speech/clean", requestId, status, Date.now() - started);
      return res;
    }
  } catch (error) {
    status = 500;
    console.error("[speech/clean] failed:", error);
    const res = NextResponse.json({ error: "Failed to clean transcript." }, { status });
    logRequestMeta("/api/speech/clean", requestId, status, Date.now() - started);
    return res;
  }
}

