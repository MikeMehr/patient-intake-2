import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const endpoint = "http://localhost/api/speech/tts";

describe("POST /api/speech/tts", () => {
  const originalHipaaMode = process.env.HIPAA_MODE;
  const originalSpeechKey = process.env.AZURE_SPEECH_KEY;
  const originalSpeechRegion = process.env.AZURE_SPEECH_REGION;
  const originalSpeechEndpoint = process.env.AZURE_SPEECH_ENDPOINT;
  const originalSpeechTtsEndpoint = process.env.AZURE_SPEECH_TTS_ENDPOINT;

  beforeEach(() => {
    process.env.HIPAA_MODE = "false";
    process.env.AZURE_SPEECH_KEY = "test-key";
    process.env.AZURE_SPEECH_REGION = "eastus";
    delete process.env.AZURE_SPEECH_ENDPOINT;
    delete process.env.AZURE_SPEECH_TTS_ENDPOINT;
  });

  afterEach(() => {
    process.env.HIPAA_MODE = originalHipaaMode;
    process.env.AZURE_SPEECH_KEY = originalSpeechKey;
    process.env.AZURE_SPEECH_REGION = originalSpeechRegion;
    process.env.AZURE_SPEECH_ENDPOINT = originalSpeechEndpoint;
    process.env.AZURE_SPEECH_TTS_ENDPOINT = originalSpeechTtsEndpoint;
    vi.restoreAllMocks();
  });

  it("returns 503 in HIPAA mode", async () => {
    process.env.HIPAA_MODE = "true";
    const request = new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", language: "en" }),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(503);
  });

  it("rejects blocked TTS endpoints", async () => {
    process.env.AZURE_SPEECH_TTS_ENDPOINT = "https://localhost:8080";
    const request = new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello world", language: "en" }),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain("Failed to synthesize speech");
  });
});
