import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const endpoint = "http://localhost/api/physician/transcription/generate";

describe("POST /api/physician/transcription/generate", () => {
  const originalHipaa = process.env.HIPAA_MODE;

  afterEach(() => {
    process.env.HIPAA_MODE = originalHipaa;
  });

  it("returns 503 when HIPAA mode blocks external AI", async () => {
    process.env.HIPAA_MODE = "true";
    const request = new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId: "11111111-1111-4111-8111-111111111111",
        transcript: "Patient reports sore throat for 3 days.",
      }),
    });

    const response = await POST(request as any);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(503);
    expect(body.error).toContain("disabled in HIPAA mode");
  });
});
