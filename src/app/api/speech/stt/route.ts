import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getAzureSpeechConfig } from "@/lib/azure-speech";
import { getSpeechLocale, normalizeLanguageCode } from "@/lib/speech-language";

type AzureSpeechResponse = {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: Array<{ Display?: string; Lexical?: string }>;
  Offset?: number;
  Duration?: number;
};

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
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid form data." }, { status });
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

  const maxAudioSize = 8 * 1024 * 1024;
  if (audio.size <= 0 || audio.size > maxAudioSize) {
    status = 400;
    const res = NextResponse.json(
      { error: "Audio file is empty or exceeds the 8MB limit." },
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
    const url =
      `${speechConfig.endpoint}/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(locale)}&format=detailed`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": speechConfig.key,
        "Content-Type": audio.type || "audio/webm",
        Accept: "application/json",
      },
      body: await audio.arrayBuffer(),
    });

    if (!response.ok) {
      status = response.status >= 500 ? 502 : response.status;
      const errText = await response.text().catch(() => "");
      const res = NextResponse.json(
        {
          error: "Azure Speech transcription request failed.",
          details:
            process.env.NODE_ENV === "development"
              ? errText || response.statusText
              : undefined,
        },
        { status },
      );
      logRequestMeta("/api/speech/stt", requestId, status, Date.now() - started);
      return res;
    }

    const payload = (await response.json()) as AzureSpeechResponse;
    const text =
      payload.DisplayText?.trim() ||
      payload.NBest?.[0]?.Display?.trim() ||
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
