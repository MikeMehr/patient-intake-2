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
    const instruction = `You are a medical transcription cleanup assistant. A patient is describing their symptoms via speech recognition, which often mishears words. Clean up the text:

1. **Fix speech recognition errors** — use medical context to correct obvious mishearings:
   - "somebody age" → "body ache" or "sore body ache"
   - "no runny, no" → "no runny nose"
   - "saw throat" → "sore throat"
   - Apply similar medical common-sense corrections.
2. **Remove filler words** — remove "uh", "um", "like", "you know" etc.
3. **Fix punctuation** — proper spacing after periods, no run-on sentences.
4. **Normalize capitalization** — capitalize first word of each sentence.
5. **Keep it concise** — preserve the patient's meaning but make it read naturally.

Keep the same language (${langName}). Do NOT add commentary or explanations. Return ONLY the corrected text.`;

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
        max_completion_tokens: 200,
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

