import type { InterviewResponse } from "@/lib/interview-schema";
import { describe, expect, it } from "vitest";
import { POST } from "./route";

const endpoint = "http://localhost/api/interview";
const patientProfile = {
  sex: "female",
  age: 32,
  pmh: "Asthma, seasonal allergies.",
  familyHistory: "Mother with hypertension, father with type 2 diabetes.",
  allergies: "Penicillin causes hives.",
} as const;

describe("POST /api/interview", () => {
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

  it("returns a question for an empty transcript when mocking", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      body: JSON.stringify({
        chiefComplaint: "3 days of sore throat",
        patientProfile,
        transcript: [],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = (await response.json()) as InterviewResponse;

    expect(response.status).toBe(200);
    expect(payload.type).toBe("question");
    if (payload.type === "question") {
      expect(payload.question.length).toBeGreaterThan(5);
    }
  });

  it("returns a summary after multiple patient turns when mocking", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      body: JSON.stringify({
        chiefComplaint: "3 days of sore throat",
        patientProfile,
        transcript: [
          { role: "patient", content: "Yes, mild dry cough." },
          { role: "assistant", content: "Have you noticed fevers?" },
          { role: "patient", content: "Fever up to 101." },
          { role: "assistant", content: "Any trouble swallowing?" },
          { role: "patient", content: "Swallowing is painful but manageable." },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = (await response.json()) as InterviewResponse;

    expect(response.status).toBe(200);
    expect(payload.type).toBe("summary");
    if (payload.type === "summary") {
      expect(payload.summary.length).toBeGreaterThan(10);
      expect(payload.plan.length).toBeGreaterThan(0);
    }
  });
});

