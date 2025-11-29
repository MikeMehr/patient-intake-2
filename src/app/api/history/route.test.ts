import type { HistoryResponse } from "@/lib/history-schema";
import { POST } from "./route";
import { describe, expect, it } from "vitest";

const endpoint = "http://localhost/api/history";

describe("POST /api/history", () => {
  it("rejects malformed JSON payloads", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      body: "not-json",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("returns structured data when mocking", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      body: JSON.stringify({ chiefComplaint: "throbbing tooth pain" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const history = (await response.json()) as HistoryResponse;

    expect(response.status).toBe(200);
    expect(history.summary).toContain("tooth pain");
    expect(history.positives.length).toBeGreaterThan(0);
    expect(history.negatives.length).toBeGreaterThan(0);
    expect(history.plan.length).toBeGreaterThan(0);
    expect(history.assessment.length).toBeGreaterThan(0);
  });
});

