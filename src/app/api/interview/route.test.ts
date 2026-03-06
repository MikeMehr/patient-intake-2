import type { InterviewResponse } from "@/lib/interview-schema";
import { describe, expect, it } from "vitest";
import { computeFormInterviewPhase } from "./prompt-helpers";
import {
  hasBodyPartLocationAnswerSignal,
  hasLocationAnswerSignal,
  hasLocationQuestionIntent,
} from "./location-signals";
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
    expect(hasLocationAnswerSignal("من محل درد را روی نمودار knee علامت زدم.".toLowerCase())).toBe(
      true,
    );
  });

  it("requires part-specific location evidence for per-part completion", () => {
    expect(
      hasBodyPartLocationAnswerSignal(
        "I marked the painful spot on the right knee diagram.".toLowerCase(),
        "knee",
      ),
    ).toBe(true);
    expect(
      hasBodyPartLocationAnswerSignal(
        "I marked the painful spot on the right knee diagram.".toLowerCase(),
        "ankle",
      ),
    ).toBe(false);
    expect(
      hasBodyPartLocationAnswerSignal(
        "من محل درد را روی نمودار knee علامت زدم.".toLowerCase(),
        "knee",
      ),
    ).toBe(true);
    expect(hasBodyPartLocationAnswerSignal("diagram marked.".toLowerCase(), "knee")).toBe(false);
  });
});

describe("MSK hard override checkpoints", () => {
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

  it("forces checkpoint at upcoming fifth question for transcript-detected MVA neck and lower back injuries", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Any bowel or bladder changes?",
      rationale: "Assess cauda equina red flags.",
    };
    const transcript = [
      { role: "assistant", content: "Tell me what happened in the collision." },
      { role: "patient", content: "I was rear-ended and now my neck and lower back hurt." },
      { role: "assistant", content: "Any numbness or weakness?" },
      { role: "patient", content: "No." },
      { role: "assistant", content: "Were airbags deployed?" },
      { role: "patient", content: "No airbags." },
      { role: "assistant", content: "Any prior injuries?" },
      { role: "patient", content: "No." },
    ] as const;

    const result = applyMskSecondQuestionOverride({
      turn,
      transcript: [...transcript],
      chiefComplaint: "motor vehicle accident",
      forceSummary: false,
      languageCode: "en",
    });

    expect(result.type).toBe("question");
    if (result.type === "question") {
      expect(result.requiresLocationMarking).toBe(true);
      expect(result.question.toLowerCase()).toContain("neck");
      expect(result.question.toLowerCase()).toContain("lower back");
    }
  });

  it("keeps forcing checkpoints for remaining unmarked parts only", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "How severe is your pain today?",
      rationale: "Assess symptom severity trend.",
    };
    const transcript = [
      { role: "assistant", content: "Tell me what happened in the collision." },
      { role: "patient", content: "I have neck and lower back pain after being rear-ended." },
      { role: "assistant", content: "Any numbness or weakness?" },
      { role: "patient", content: "No." },
      { role: "assistant", content: "Did airbags deploy?" },
      { role: "patient", content: "No." },
      { role: "assistant", content: "Any previous injuries?" },
      { role: "patient", content: "I marked the painful spot on the neck diagram." },
    ] as const;

    const result = applyMskSecondQuestionOverride({
      turn,
      transcript: [...transcript],
      chiefComplaint: "motor vehicle accident",
      forceSummary: false,
      languageCode: "en",
    });

    expect(result.type).toBe("question");
    if (result.type === "question") {
      expect(result.requiresLocationMarking).toBe(true);
      expect(result.question.toLowerCase()).toContain("lower back");
      expect(result.question.toLowerCase()).not.toContain("neck");
    }
  });

  it("does not force at checkpoints once all required parts are marked", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "How has this affected your sleep?",
      rationale: "Assess functional impact.",
    };
    const transcript = [
      { role: "assistant", content: "Tell me what happened in the collision." },
      { role: "patient", content: "I have neck and lower back pain after being rear-ended." },
      { role: "assistant", content: "Any numbness or weakness?" },
      { role: "patient", content: "No." },
      { role: "assistant", content: "Did airbags deploy?" },
      { role: "patient", content: "No." },
      { role: "assistant", content: "Any previous injuries?" },
      { role: "patient", content: "I marked the painful spot on the neck diagram." },
      { role: "patient", content: "I marked the painful spot on the lower back diagram." },
    ] as const;

    const result = applyMskSecondQuestionOverride({
      turn,
      transcript: [...transcript],
      chiefComplaint: "motor vehicle accident",
      forceSummary: false,
      languageCode: "en",
    });

    expect(result).toEqual(turn);
  });

  it("does not infer neck pain from assistant prompts or negated patient response", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Any instability when walking?",
      rationale: "Check ankle mechanical instability.",
    };
    const transcript = [
      { role: "assistant", content: "I understand you were in a motor vehicle accident. What happened?" },
      {
        role: "patient",
        content:
          "I was rear-ended and now I have right ankle pain and low back pain.",
      },
      {
        role: "assistant",
        content:
          "Looking at the diagram/photo of your lower back and ankle, please mark exactly where it hurts.",
      },
      { role: "patient", content: "I marked the painful spot on the lower back diagram." },
      {
        role: "assistant",
        content:
          "Since the accident, have you had any of the following: loss of consciousness, numbness, tingling, weakness, or neck pain?",
      },
      { role: "patient", content: "I'm not having any neck pain." },
      { role: "assistant", content: "How would you describe the right ankle pain?" },
      { role: "patient", content: "Aching, with some swelling on the outside." },
    ] as const;

    const result = applyMskSecondQuestionOverride({
      turn,
      transcript: [...transcript],
      chiefComplaint: "motor vehicle accident",
      forceSummary: false,
      languageCode: "en",
    });

    expect(result.type).toBe("question");
    if (result.type === "question") {
      expect(result.requiresLocationMarking).toBe(true);
      expect(result.question.toLowerCase()).toContain("ankle");
      expect(result.question.toLowerCase()).not.toContain("neck");
      expect(result.question.toLowerCase()).not.toContain("lower back");
    }
  });

  it("does not add foot from non-symptom accident details", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Any numbness or tingling down the legs?",
      rationale: "Assess lumbar radicular symptoms.",
    };
    const transcript = [
      { role: "assistant", content: "Can you describe your symptoms?" },
      { role: "patient", content: "I have neck pain and right lower back pain." },
      {
        role: "assistant",
        content:
          "A few details about the accident itself: was there significant damage to your vehicle, did airbags deploy, and was there an ambulance?",
      },
      {
        role: "patient",
        content:
          "My insurance is ICBC claim F-250. Minor rear damage. No police or ambulance. Seat belt on, no airbags.",
      },
      { role: "assistant", content: "How is your low back motion?" },
      {
        role: "patient",
        content:
          "Pain is in the right lower back and neck. Tender to touch and worse with flexion at end range.",
      },
      { role: "assistant", content: "Any prior injuries?" },
      { role: "patient", content: "No previous injuries." },
    ] as const;

    const result = applyMskSecondQuestionOverride({
      turn,
      transcript: [...transcript],
      chiefComplaint: "motor vehicle accident",
      forceSummary: false,
      languageCode: "en",
    });

    expect(result.type).toBe("question");
    if (result.type === "question") {
      expect(result.requiresLocationMarking).toBe(true);
      expect(result.question.toLowerCase()).toContain("neck");
      expect(result.question.toLowerCase()).toContain("lower back");
      expect(result.question.toLowerCase()).not.toContain("foot");
    }
  });

  it("still keeps foot when explicitly reported in symptom context", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Do you have pain when bearing weight?",
      rationale: "Assess severity of foot injury.",
    };
    const transcript = [
      { role: "assistant", content: "Tell me about your injury." },
      { role: "patient", content: "I have neck pain and pain on top of my right foot after the crash." },
    ] as const;

    const result = applyMskSecondQuestionOverride({
      turn,
      transcript: [...transcript],
      chiefComplaint: "motor vehicle accident",
      forceSummary: false,
      languageCode: "en",
    });

    expect(result.type).toBe("question");
    if (result.type === "question") {
      expect(result.requiresLocationMarking).toBe(true);
      expect(result.question.toLowerCase()).toContain("neck");
      expect(result.question.toLowerCase()).toContain("foot");
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

  it("does not force back diagram when patient says pain comes back for headache", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Do you have nausea with the headache?",
      rationale: "Assess migraine-associated symptoms.",
    };
    const transcript = [
      { role: "assistant", content: "When did the headache start?" },
      { role: "patient", content: "About 3 days ago. Advil helps with pain but it tends to come back." },
    ] as const;

    const result = applyMskSecondQuestionOverride({
      turn,
      transcript: [...transcript],
      chiefComplaint: "3 days of headache",
      forceSummary: false,
      languageCode: "en",
    });

    expect(result).toEqual(turn);
  });

  it("does not force override outside checkpoint turns", () => {
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
});

