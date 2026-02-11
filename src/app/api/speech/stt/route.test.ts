import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const endpoint = "http://localhost/api/speech/stt";

describe("POST /api/speech/stt", () => {
  const originalHipaaMode = process.env.HIPAA_MODE;
  const originalSpeechKey = process.env.AZURE_SPEECH_KEY;
  const originalSpeechRegion = process.env.AZURE_SPEECH_REGION;
  const originalSpeechEndpoint = process.env.AZURE_SPEECH_ENDPOINT;

  beforeEach(() => {
    process.env.HIPAA_MODE = "false";
    process.env.AZURE_SPEECH_KEY = "test-key";
    process.env.AZURE_SPEECH_REGION = "eastus";
    delete process.env.AZURE_SPEECH_ENDPOINT;
  });

  afterEach(() => {
    process.env.HIPAA_MODE = originalHipaaMode;
    process.env.AZURE_SPEECH_KEY = originalSpeechKey;
    process.env.AZURE_SPEECH_REGION = originalSpeechRegion;
    process.env.AZURE_SPEECH_ENDPOINT = originalSpeechEndpoint;
    vi.restoreAllMocks();
  });

  it("returns 400 when audio file is missing", async () => {
    const form = new FormData();
    form.append("language", "en");
    const request = new Request(endpoint, {
      method: "POST",
      body: form,
    });

    const response = await POST(request as any);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("No audio file provided");
  });

  it("returns 503 in HIPAA mode", async () => {
    process.env.HIPAA_MODE = "true";
    const form = new FormData();
    form.append("language", "en");
    form.append("audio", new File(["audio"], "test.webm", { type: "audio/webm" }));

    const request = new Request(endpoint, {
      method: "POST",
      body: form,
    });

    const response = await POST(request as any);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(503);
    expect(body.error).toContain("disabled in HIPAA mode");
  });

  it("returns transcript text for successful Azure STT response", async () => {
    const azurePayload = {
      RecognitionStatus: "Success",
      DisplayText: "Patient reports mild earache for two days.",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(azurePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const form = new FormData();
    form.append("language", "en");
    form.append("audio", new File(["audio"], "test.webm", { type: "audio/webm" }));
    const request = new Request(endpoint, {
      method: "POST",
      body: form,
    });

    const response = await POST(request as any);
    const body = (await response.json()) as { text?: string; status?: string };

    expect(response.status).toBe(200);
    expect(body.text).toBe("Patient reports mild earache for two days.");
    expect(body.status).toBe("Success");
  });
});
