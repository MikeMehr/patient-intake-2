import { ensureProdEnv } from "@/lib/required-env";

export function getAzureSpeechConfig() {
  ensureProdEnv(["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"]);

  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  const endpointOverride = process.env.AZURE_SPEECH_ENDPOINT;

  if (!key || !region) {
    throw new Error(
      "Azure Speech is not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION."
    );
  }

  const endpoint = endpointOverride?.trim().length
    ? endpointOverride.replace(/\/$/, "")
    : `https://${region}.stt.speech.microsoft.com`;

  return { key, region, endpoint };
}
