import { getAzureSpeechConfig } from "@/lib/azure-speech";
import { getSpeechLocale, normalizeLanguageCode } from "@/lib/speech-language";
import { assertSafeOutboundUrl } from "@/lib/outbound-url";

type FastTranscriptionResponse = {
  durationMilliseconds?: number;
  combinedPhrases?: Array<{ text?: string }>;
  phrases?: Array<{ text?: string }>;
};

export async function transcribeWavBuffer(params: {
  wavBuffer: ArrayBuffer;
  languageCode: string;
}): Promise<{ text: string; locale: string }> {
  const speechConfig = getAzureSpeechConfig();
  const locale = getSpeechLocale(normalizeLanguageCode(params.languageCode));

  const url =
    `https://${speechConfig.region}.api.cognitive.microsoft.com` +
    `/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
  const safeUrl = assertSafeOutboundUrl(url, { label: "Speech STT endpoint URL" });

  const audioBlob = new Blob([params.wavBuffer], { type: "audio/wav" });
  const azureForm = new FormData();
  azureForm.append("audio", new File([audioBlob], "recording.wav", { type: "audio/wav" }));
  azureForm.append("definition", JSON.stringify({ locales: [locale] }));

  const response = await fetch(safeUrl.toString(), {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": speechConfig.key },
    body: azureForm,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw Object.assign(
      new Error(`Azure Fast Transcription returned ${response.status}: ${errText || response.statusText}`),
      { statusCode: response.status >= 500 ? 502 : response.status, details: errText },
    );
  }

  const payload = (await response.json()) as FastTranscriptionResponse;

  const text =
    payload.combinedPhrases?.[0]?.text?.trim() ||
    payload.phrases?.map((p) => p.text?.trim()).filter(Boolean).join(" ") ||
    "";

  return { text, locale };
}
