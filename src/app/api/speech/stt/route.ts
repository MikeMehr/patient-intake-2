import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getAzureSpeechConfig } from "@/lib/azure-speech";
import { getSpeechLocale, normalizeLanguageCode } from "@/lib/speech-language";
import { assertSafeOutboundUrl } from "@/lib/outbound-url";

// Allow longer timeouts for large audio upload + Azure transcription
export const maxDuration = 120;

type FastTranscriptionResponse = {
  durationMilliseconds?: number;
  combinedPhrases?: Array<{ text?: string }>;
  phrases?: Array<{ text?: string }>;
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
    // Fast Transcription API — handles up to 2 hours of audio synchronously.
    // Uses a different base domain than the short-audio REST endpoint.
    const url =
      `https://${speechConfig.region}.api.cognitive.microsoft.com` +
      `/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
    const safeUrl = assertSafeOutboundUrl(url, { label: "Speech STT endpoint URL" });

    const azureForm = new FormData();
    azureForm.append("audio", audio, audio.name || "recording.wav");
    azureForm.append("definition", JSON.stringify({ locales: [locale] }));

    const response = await fetch(safeUrl.toString(), {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": speechConfig.key,
      },
      body: azureForm,
    });

    if (!response.ok) {
      status = response.status >= 500 ? 502 : response.status;
      const errText = await response.text().catch(() => "");
      console.error(
        `[speech/stt] Azure Fast Transcription returned ${response.status}: ${errText || response.statusText}`,
        { locale, audioSize: audio.size },
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

    const payload = (await response.json()) as FastTranscriptionResponse;

    if (process.env.NODE_ENV === "development") {
      console.log("[speech/stt] Azure Fast Transcription response:", JSON.stringify(payload, null, 2));
      console.log("[speech/stt] Audio size:", audio.size, "duration ms:", payload.durationMilliseconds);
    }

    // combinedPhrases[0].text is the full concatenated transcript
    const text =
      payload.combinedPhrases?.[0]?.text?.trim() ||
      payload.phrases?.map((p) => p.text?.trim()).filter(Boolean).join(" ") ||
      "";

    const res = NextResponse.json({ text, language: locale });
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
