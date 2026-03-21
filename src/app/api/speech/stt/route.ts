import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getAzureSpeechConfig } from "@/lib/azure-speech";
import { getSpeechLocale, normalizeLanguageCode } from "@/lib/speech-language";
import { assertSafeOutboundUrl } from "@/lib/outbound-url";

// Allow longer timeouts for large audio upload + Azure transcription
export const maxDuration = 60;

type AzureSpeechResponse = {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: Array<{ Display?: string; Lexical?: string }>;
  Offset?: number;
  Duration?: number;
};

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

  let speechConfig;
  try {
    speechConfig = getAzureSpeechConfig();
  } catch (err) {
    status = 500;
    const res = NextResponse.json(
      { error: (err as Error).message || "Azure Speech is not configured." },
      { status },
    );
    logRequestMeta("/api/speech/stt", requestId, status, Date.now() - started);
    return res;
  }

  const locale = getSpeechLocale(languageCode);

  try {
    // Use dictation mode (vs conversation) — it tolerates longer mid-speech pauses
    // and is designed for continuous, long-form speech like patient descriptions.
    // speechsegmentationsilencetimeoutms=30000 gives Azure up to 30 seconds of
    // end-of-speech silence before it stops — prevents cutting off after a pause.
    const url =
      `${speechConfig.endpoint}/speech/recognition/dictation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(locale)}&format=detailed&speechsegmentationsilencetimeoutms=30000`;
    const safeUrl = assertSafeOutboundUrl(url, { label: "Speech STT endpoint URL" });

    // Azure STT REST API requires the specific codec/samplerate MIME type for WAV PCM.
    // Sending just "audio/wav" is rejected with 400 by many Azure regions.
    const isWav = (audio.type || "").toLowerCase().includes("wav");
    const contentType = isWav
      ? "audio/wav; codecs=audio/pcm; samplerate=16000"
      : (audio.type || "audio/webm");

    const response = await fetch(safeUrl.toString(), {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": speechConfig.key,
        "Content-Type": contentType,
        Accept: "application/json",
      },
      body: await audio.arrayBuffer(),
    });

    if (!response.ok) {
      status = response.status >= 500 ? 502 : response.status;
      const errText = await response.text().catch(() => "");
      // Always log Azure's error body server-side for diagnosability
      console.error(
        `[speech/stt] Azure returned ${response.status}: ${errText || response.statusText}`,
        { locale, audioType: contentType, audioSize: audio.size },
      );
      const res = NextResponse.json(
        {
          error: "Azure Speech transcription request failed.",
          details: errText || response.statusText || undefined,
        },
        { status },
      );
      logRequestMeta("/api/speech/stt", requestId, status, Date.now() - started);
      return res;
    }

    const payload = (await response.json()) as AzureSpeechResponse;

    if (process.env.NODE_ENV === "development") {
      console.log("[speech/stt] Azure response:", JSON.stringify(payload, null, 2));
      console.log("[speech/stt] Audio type:", audio.type, "size:", audio.size);
    }

    // Prefer NBest[0].Display — it has better punctuation/spacing than DisplayText
    const text =
      payload.NBest?.[0]?.Display?.trim() ||
      payload.DisplayText?.trim() ||
      payload.NBest?.[0]?.Lexical?.trim() ||
      "";

    const res = NextResponse.json({
      text,
      status: payload.RecognitionStatus || "Success",
      language: locale,
    });
    logRequestMeta("/api/speech/stt", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 502;
    console.error("[speech/stt] failed:", error);
    const res = NextResponse.json(
      { error: "Failed to transcribe audio." },
      { status },
    );
    logRequestMeta("/api/speech/stt", requestId, status, Date.now() - started);
    return res;
  }
}
