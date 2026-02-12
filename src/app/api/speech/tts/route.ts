import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getAzureSpeechConfig } from "@/lib/azure-speech";
import {
  getAzureTtsVoiceName,
  getSpeechLocale,
  normalizeLanguageCode,
} from "@/lib/speech-language";

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function getAzureTtsEndpoint(): string {
  const explicit = process.env.AZURE_SPEECH_TTS_ENDPOINT?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  const generic = process.env.AZURE_SPEECH_ENDPOINT?.trim();
  if (generic) {
    return generic.replace(/\/$/, "").replace(".stt.", ".tts.");
  }

  const { region } = getAzureSpeechConfig();
  return `https://${region}.tts.speech.microsoft.com`;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Speech synthesis is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/speech/tts", requestId, status, Date.now() - started);
    return res;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON payload." }, { status });
    logRequestMeta("/api/speech/tts", requestId, status, Date.now() - started);
    return res;
  }

  const body = payload as { text?: string; language?: string };
  const text = (body.text || "").trim();
  const languageCode = normalizeLanguageCode(body.language);
  const locale = getSpeechLocale(languageCode);
  const voice = getAzureTtsVoiceName(locale);

  if (!text) {
    status = 400;
    const res = NextResponse.json({ error: "Text is required." }, { status });
    logRequestMeta("/api/speech/tts", requestId, status, Date.now() - started);
    return res;
  }

  if (text.length > 2500) {
    status = 400;
    const res = NextResponse.json({ error: "Text exceeds 2500 characters." }, { status });
    logRequestMeta("/api/speech/tts", requestId, status, Date.now() - started);
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
    logRequestMeta("/api/speech/tts", requestId, status, Date.now() - started);
    return res;
  }

  const endpoint = getAzureTtsEndpoint();
  const ssml = `<speak version="1.0" xml:lang="${locale}"><voice name="${voice}">${xmlEscape(
    text,
  )}</voice></speak>`;

  try {
    const response = await fetch(`${endpoint}/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": speechConfig.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
        "User-Agent": "patient-intake-2",
      },
      body: ssml,
    });

    if (!response.ok) {
      status = response.status >= 500 ? 502 : response.status;
      const errText = await response.text().catch(() => "");
      const res = NextResponse.json(
        {
          error: "Azure Speech synthesis request failed.",
          details:
            process.env.NODE_ENV === "development"
              ? errText || response.statusText
              : undefined,
        },
        { status },
      );
      logRequestMeta("/api/speech/tts", requestId, status, Date.now() - started);
      return res;
    }

    const audioBuffer = await response.arrayBuffer();
    const res = new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
    logRequestMeta("/api/speech/tts", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 502;
    console.error("[speech/tts] failed:", error);
    const res = NextResponse.json(
      { error: "Failed to synthesize speech." },
      { status },
    );
    logRequestMeta("/api/speech/tts", requestId, status, Date.now() - started);
    return res;
  }
}
