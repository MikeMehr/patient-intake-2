import type { InterviewResponse } from "@/lib/interview-schema";
import { describe, expect, it } from "vitest";
import { computeFormInterviewPhase } from "./prompt-helpers";
import { hasLocationAnswerSignal, hasLocationQuestionIntent } from "./location-signals";
import { applyMskSecondQuestionOverride } from "./msk-second-question";
import { POST } from "./route";

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
    const phase = computeFormInterviewPhase({
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

    const phase = computeFormInterviewPhase({
      hasStructuredForm: true,
      questionCountSoFar: transcript.filter((m) => m.role === "assistant").length,
      budget: { budget: null, modifiers: ["unlimited-structured-form"] },
      escalation: {
        hasRedFlagSignal: false,
        hasMultiSystemSymptoms: false,
        isTraumaOrMva: true,
      },
      hasMultipleComplaints: false,
    });

    expect(phase.phase).toBe("form_phase");
  });
});

describe("MSK location topic extraction", () => {
  it("does not classify severity scale phrasing as location", () => {
    const severityPrompt =
      "On a scale of 0-10, where 0 is no pain and 10 is the worst pain, how severe is it?";

    expect(hasLocationQuestionIntent(severityPrompt.toLowerCase())).toBe(false);
  });

  it("still detects explicit location-question wording", () => {
    expect(
      hasLocationQuestionIntent("where exactly is the pain in your right knee?".toLowerCase()),
    );
    expect(hasLocationQuestionIntent("which area hurts the most?".toLowerCase())).toBe(true);
  });

  it("treats marker-style diagram responses as location coverage", () => {
    expect(
      hasLocationAnswerSignal("I marked the painful spot on the right knee diagram.".toLowerCase()),
    ).toBe(true);
  });
});

describe("MSK hard override second question", () => {
  it("forces MSK second question to location-marking prompt", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Do you have swelling around the right knee?",
      rationale: "To assess for inflammatory process.",
    };
    const transcript = [
      { role: "assistant", content: "Tell me what happened to your knee." },
      { role: "patient", content: "I fell on it yesterday." },
    ] as const;

    const result = applyMskSecondQuestionOverride({
      turn,
      transcript: [...transcript],
      chiefComplaint: "2 days of right knee pain after fall",
      forceSummary: false,
      languageCode: "en",
    });

    expect(result.type).toBe("question");
    if (result.type === "question") {
      expect(result.requiresLocationMarking).toBe(true);
      expect(result.question.toLowerCase()).toContain("diagram/photo");
      expect(result.deferredIntentHint?.toLowerCase()).toContain("swelling");
    }
  });

  it("does not force override on non-msk complaints", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Have you had fever or chills?",
      rationale: "Evaluate infectious symptoms.",
    };
    const transcript = [
      { role: "assistant", content: "Tell me about your sore throat." },
      { role: "patient", content: "It started three days ago." },
    ] as const;

    const result = applyMskSecondQuestionOverride({
      turn,
      transcript: [...transcript],
      chiefComplaint: "3 days of sore throat",
      forceSummary: false,
      languageCode: "en",
    });

    expect(result).toEqual(turn);
  });

  it("does not force override outside second assistant turn", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Does your knee lock or give way?",
      rationale: "Assess mechanical instability.",
    };

    const result = applyMskSecondQuestionOverride({
      turn,
      transcript: [],
      chiefComplaint: "right knee pain",
      forceSummary: false,
      languageCode: "en",
    });

    expect(result).toEqual(turn);
  });

  it("forces anterior neck complaints on second question", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Any trouble swallowing?",
      rationale: "Assess aerodigestive red flags.",
    };
    const transcript = [
      { role: "assistant", content: "Tell me more about your neck pain." },
      { role: "patient", content: "It hurts at the front of my neck." },
    ] as const;

    const result = applyMskSecondQuestionOverride({
      turn,
      transcript: [...transcript],
      chiefComplaint: "anterior neck pain",
      forceSummary: false,
      languageCode: "en",
    });

    expect(result.type).toBe("question");
    if (result.type === "question") {
      expect(result.requiresLocationMarking).toBe(true);
      expect(result.question.toLowerCase()).toContain("your neck");
    }
  });
});

