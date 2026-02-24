import type { InterviewResponse } from "@/lib/interview-schema";
import { describe, expect, it } from "vitest";
import { __interviewRouteTestUtils, POST } from "./route";

const endpoint = "http://localhost/api/interview";
const patientProfile = {
  sex: "female",
  age: 32,
  pmh: "Asthma, seasonal allergies.",
  familyHistory: "Mother with hypertension, father with type 2 diabetes.",
  familyDoctor: "Dr. Example",
  currentMedications: "Salbutamol inhaler as needed.",
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
        patientEmail: "patient@example.com",
        physicianId: "physician-1234567890",
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
        patientEmail: "patient@example.com",
        physicianId: "physician-1234567890",
        transcript: [
          { role: "patient", content: "Yes, mild dry cough." },
          { role: "patient", content: "Fever up to 101." },
          { role: "patient", content: "Swallowing is painful but manageable." },
          { role: "patient", content: "No trouble breathing." },
          { role: "patient", content: "No vomiting." },
          { role: "patient", content: "No rash." },
          { role: "patient", content: "I tried ibuprofen; it helped a bit." },
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

describe("interview prompt phase controller", () => {
  it("uses HPI_FIRST phase in first half when a form exists", () => {
    const phase = __interviewRouteTestUtils.computeFormInterviewPhase({
      hasStructuredForm: true,
      questionCountSoFar: 3,
      budget: { budget: null, modifiers: ["unlimited-structured-form"] },
      escalation: {
        active: true,
        reasons: ["structured-form-uploaded"],
        hasRedFlagSignal: false,
        hasMultiSystemSymptoms: false,
        hasChronicComplexity: false,
        isTraumaOrMva: false,
        hasMedicoLegalDocumentation: false,
        hasStructuredFormUpload: true,
      },
      hasMultipleComplaints: false,
    });

    expect(phase.phase).toBe("hpi_phase");
    expect(phase.secondHalfStart).toBeGreaterThan(phase.questionCountSoFar);
  });

  it("switches to FORM_CATCHUP in later half and retains safety precedence text", () => {
    const transcript = [
      { role: "assistant", content: "Tell me about your shoulder pain." },
      { role: "patient", content: "It started last week." },
      { role: "assistant", content: "Where exactly is the pain located?" },
      { role: "patient", content: "Right shoulder and upper arm." },
      { role: "assistant", content: "How severe is it from 0 to 10?" },
      { role: "patient", content: "About 7 out of 10." },
      { role: "assistant", content: "What movements make it worse?" },
      { role: "patient", content: "Lifting and reaching overhead." },
      { role: "assistant", content: "Any numbness or weakness?" },
      { role: "patient", content: "No numbness." },
      { role: "assistant", content: "Any prior injury to this shoulder?" },
      { role: "patient", content: "Not before this one." },
      { role: "assistant", content: "Does this limit your work duties?" },
      { role: "patient", content: "Yes, I cannot lift heavy boxes." },
    ] as const;

    const prompt = __interviewRouteTestUtils.buildPrompt(
      "Right shoulder pain after work injury",
      patientProfile,
      transcript as any,
      null,
      null,
      null,
      "Work injury form asks for injury date, mechanism, activity limitation, and prior injury history.",
      null,
      null,
      null,
      false,
      "English",
    );

    expect(prompt).toContain("Current phase: FORM_CATCHUP");
    expect(prompt).toContain("FORM COVERAGE REMINDER");
    expect(prompt).toContain("Safety-critical or urgent clarification questions can be asked in any phase.");
  });
});

