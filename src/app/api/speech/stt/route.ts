import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { normalizeLanguageCode } from "@/lib/speech-language";
import { transcribeWavBuffer } from "@/lib/azure-speech-transcribe";

// Allow longer timeouts for large audio upload + Azure transcription
export const maxDuration = 120;

const MAX_AUDIO_SIZE_BYTES = 100 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Speech transcription is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/speech/stt", requestId, status, Date.now() - started);
    return res;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    status = 400;
    const message = error instanceof Error ? error.message : String(error);
    const isLikelyTooLarge = /\btoo large\b|\blimit\b|\bentity\b|\bpayload\b|\bsize\b|\blength\b|\bexceeded\b/i.test(message);
    console.error("[speech/stt] formData parse failed:", message, error);
    const res = NextResponse.json(
      {
        error: isLikelyTooLarge
          ? "Audio upload is too large. Keep each clip under 100MB."
          : "Invalid form data. Ensure the request contains an audio file and is under the platform size limit.",
        details: process.env.NODE_ENV === "development" ? message || undefined : undefined,
      },
      { status },
    );
    logRequestMeta("/api/speech/stt", requestId, status, Date.now() - started);
    return res;
  }

  const audio = formData.get("audio");
  const rawLanguage = formData.get("language");
  const languageCode = normalizeLanguageCode(
    typeof rawLanguage === "string" ? rawLanguage : "en",
  );

  if (!(audio instanceof File)) {
    status = 400;
    const res = NextResponse.json(
      { error: "No audio file provided. Expected field name 'audio'." },
      { status },
    );
    logRequestMeta("/api/speech/stt", requestId, status, Date.now() - started);
    return res;
  }

  if (audio.size <= 0 || audio.size > MAX_AUDIO_SIZE_BYTES) {
    status = 400;
    const res = NextResponse.json(
      { error: "Audio file is empty or exceeds the 100MB limit." },
      { status },
    );
    logRequestMeta("/api/speech/stt", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const wavBuffer = await audio.arrayBuffer();
    const { text, locale } = await transcribeWavBuffer({ wavBuffer, languageCode });

    if (process.env.NODE_ENV === "development") {
      console.log("[speech/stt] transcribed", audio.size, "bytes →", text.length, "chars, locale:", locale);
    }

    const res = NextResponse.json({ text, language: locale });
    logRequestMeta("/api/speech/stt", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    const err = error as { statusCode?: number; details?: string; message?: string };
    status = err.statusCode ?? 502;
    console.error("[speech/stt] failed:", error);
    const res = NextResponse.json(
      {
        error: "Failed to transcribe audio.",
        details: err.details || undefined,
      },
      { status },
    );
    logRequestMeta("/api/speech/stt", requestId, status, Date.now() - started);
    return res;
  }
}
