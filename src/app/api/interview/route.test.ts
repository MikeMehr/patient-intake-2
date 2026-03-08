import type { InterviewResponse } from "@/lib/interview-schema";
import { describe, expect, it } from "vitest";
import {
  applySensitivePhotoSuppressionToTurn,
  computeFormInterviewPhase,
  getMvaFollowUpPromptSection,
  getSensitivePhotoContext,
  isLikelyMvaFollowUpContext,
  isPhotoUploadRequestText,
} from "./prompt-helpers";
import { buildPrompt } from "./prompt-builder";
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
      expect(payload.progress).toBeDefined();
      expect(payload.progress?.questionsAsked).toBe(1);
      expect(payload.progress?.approxTotalQuestions).toBeGreaterThanOrEqual(
        payload.progress?.questionsAsked ?? 0,
      );
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
        forceSummary: true,
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
      expect(payload.progress).toBeDefined();
      expect(payload.progress?.questionsAsked).toBeGreaterThanOrEqual(0);
      expect(payload.progress?.approxTotalQuestions).toBeGreaterThanOrEqual(
        payload.progress?.questionsAsked ?? 0,
      );
    }
  });

  it("uses the controller to return a clarification question when the patient corrects the assistant", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      body: JSON.stringify({
        chiefComplaint: "upper abdominal lumps",
        patientProfile,
        patientEmail: "patient@example.com",
        physicianId: "physician-1234567890",
        transcript: [
          {
            role: "assistant",
            content:
              "I noted your concern about chest pain, and I'll come back to that once we finish discussing the abdominal lump. For the lump itself, does it flatten when you lie down?",
          },
          { role: "patient", content: "I didn't mention anything about chest pain." },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = (await response.json()) as InterviewResponse;

    expect(response.status).toBe(200);
    expect(payload.type).toBe("question");
    if (payload.type === "question") {
      expect(payload.question.toLowerCase()).toContain("clarify");
    }
  });

  it("uses the controller to return an early-stop summary after repeated unresolved misunderstanding", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      body: JSON.stringify({
        chiefComplaint: "upper abdominal lumps",
        patientProfile,
        patientEmail: "patient@example.com",
        physicianId: "physician-1234567890",
        transcript: [
          {
            role: "assistant",
            content:
              "I noted your concern about chest pain, and I'll come back to that once we finish discussing the abdominal lump. For the lump itself, does it flatten when you lie down?",
          },
          { role: "patient", content: "I didn't mention anything about chest pain." },
          {
            role: "assistant",
            content:
              "I'm sorry, I may not be understanding correctly. Could you clarify whether you were only describing the abdominal lumps?",
          },
          { role: "patient", content: "I didn't mention chest pain. I was talking about the abdominal lumps." },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = (await response.json()) as InterviewResponse;

    expect(response.status).toBe(200);
    expect(payload.type).toBe("summary");
  });

  it("uses the controller to early-stop after repeated denial of the active complaint", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      body: JSON.stringify({
        chiefComplaint: "abdominal pain",
        patientProfile,
        patientEmail: "patient@example.com",
        physicianId: "physician-1234567890",
        transcript: [
          {
            role: "assistant",
            content: "Can you tell me what’s been going on with your abdominal pain?",
          },
          {
            role: "patient",
            content: "I am not having abdominal pain. This is actually a follow-up about ultrasound results.",
          },
          {
            role: "assistant",
            content:
              "I want to make sure I understood you correctly. Could you clarify whether you are denying abdominal pain and want to focus on another concern instead?",
          },
          {
            role: "patient",
            content: "Correct, no abdominal pain. I only want to discuss the ultrasound result.",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = (await response.json()) as InterviewResponse;

    expect(response.status).toBe(200);
    expect(payload.type).toBe("summary");
  });

  it("summarizes when the patient repeatedly redirects to another queued concern", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      body: JSON.stringify({
        chiefComplaint: "type 2 diabetes follow-up",
        patientProfile,
        patientEmail: "patient@example.com",
        physicianId: "physician-1234567890",
        transcript: [
          {
            role: "assistant",
            content:
              "Tell me how your diabetes has been doing lately, including any home glucose readings or symptoms.",
          },
          {
            role: "patient",
            content:
              "My sugars have mostly been stable. I also want to discuss my abdominal ultrasound for fatty liver.",
          },
          {
            role: "assistant",
            content:
              "Have you had increased thirst, increased urination, blurred vision, or any symptoms of low blood sugar?",
          },
          {
            role: "patient",
            content:
              "No to those. Can we talk about the abdominal ultrasound for fatty liver now?",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = (await response.json()) as InterviewResponse;

    expect(response.status).toBe(200);
    expect(payload.type).toBe("summary");
  });
});

describe("dynamic complaint queue prompt guidance", () => {
  it("renders a controller-first prompt that acknowledges newly queued complaints", () => {
    const prompt = buildPrompt(
      "right knee lump",
      patientProfile,
      [
        { role: "assistant", content: "Tell me about the lump and pain behind your right knee." },
        {
          role: "patient",
          content:
            "It started a month ago. It is aching 7 out of 10 behind my right knee, worse with bending and driving, and better with icing and naproxen.",
        },
        {
          role: "assistant",
          content:
            "Any other symptoms with the knee, such as locking, giving way, numbness, tingling, color change, inability to bear weight, major swelling, or deformity?",
        },
        {
          role: "patient",
          content: "No to all of those. Also having right elbow pain with lifting or weight-bearing activities.",
        },
      ],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      "English",
      null,
      {
        suppressPhotoRequest: false,
        reason: null,
        matchedScope: null,
      },
    );

    expect(prompt).toContain("BACKEND-SELECTED NEXT ACTION: ASK ONE TARGETED QUESTION");
    expect(prompt).toContain('Current active complaint: "right knee lump"');
    expect(prompt).toContain("NEW CONCERNS TO ACKNOWLEDGE:");
    expect(prompt).toContain('"right elbow pain"');
    expect(prompt).toContain('continue only with the backend-selected next step below');
  });

  it("keeps the current complaint active when a new concern is queued", () => {
    const prompt = buildPrompt(
      "prostate issues",
      patientProfile,
      [
        { role: "assistant", content: "Tell me about the prostate symptoms you've been noticing." },
        {
          role: "patient",
          content:
            "I stopped tamsulosin a week ago. My stream is a bit weaker, and I am getting up at night to urinate.",
        },
        {
          role: "assistant",
          content:
            "Since stopping it, have you had urinary retention, blood in the urine, fever, chills, or severe pelvic pain?",
        },
        {
          role: "patient",
          content:
            "No. Also I'm worried about diabetes. I was previously diagnosed with prediabetes and my A1C was 5.8.",
        },
      ],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      "English",
      null,
      {
        suppressPhotoRequest: false,
        reason: null,
        matchedScope: null,
      },
    );

    expect(prompt).toContain("NEW CONCERNS TO ACKNOWLEDGE:");
    expect(prompt).toContain('"blood sugar concern"');
    expect(prompt).toContain('Current active complaint: "prostate issues"');
    expect(prompt).toContain("BACKEND-SELECTED NEXT ACTION: ASK ONE TARGETED QUESTION");
  });

  it("uses a brief secondary concern note instead of queueing an improving concern", () => {
    const prompt = buildPrompt(
      "abdominal pain",
      patientProfile,
      [
        { role: "assistant", content: "Tell me about the abdominal pain." },
        { role: "patient", content: "It started a month ago and is gradually improving." },
        {
          role: "assistant",
          content: "Did you have any nausea, vomiting, constipation, or other symptoms when it first started?",
        },
        {
          role: "patient",
          content:
            "I went to the ER in February and also experienced a headache, but that has pretty much gone away now.",
        },
      ],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      "English",
      null,
      {
        suppressPhotoRequest: false,
        reason: null,
        matchedScope: null,
      },
    );

    expect(prompt).toContain("BRIEF SECONDARY CONCERN NOTE:");
    expect(prompt).toContain('"headache"');
    expect(prompt).toContain('return to "abdominal pain"');
    expect(prompt).not.toContain("NEW CONCERNS TO ACKNOWLEDGE:");
  });

  it("acknowledges a first-turn fatty-liver follow-up concern while keeping diabetes active", () => {
    const prompt = buildPrompt(
      "type 2 diabetes",
      patientProfile,
      [
        {
          role: "assistant",
          content:
            "I understand you’re here for a follow-up regarding type 2 diabetes. Can you tell me how things have been going with your diabetes recently and what prompted this follow-up visit?",
        },
        {
          role: "patient",
          content: "This is a follow-up for type 2 diabetes and my recent abdominal ultrasound for fatty liver.",
        },
      ],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      "English",
      null,
      {
        suppressPhotoRequest: false,
        reason: null,
        matchedScope: null,
      },
    );

    expect(prompt).toContain("NEW CONCERNS TO ACKNOWLEDGE:");
    expect(prompt).toContain('"liver function concern"');
    expect(prompt).toContain('Current active complaint: "type 2 diabetes"');
  });

  it("does not add a chest-pain acknowledgment for negated breast pain in a new concern turn", () => {
    const prompt = buildPrompt(
      "upper abdominal lumps",
      patientProfile,
      [
        {
          role: "assistant",
          content:
            "Because you’ve noticed this more around your menstrual period, have you had any other cycle-related changes such as heavier bleeding, pelvic pain, or breast tenderness?",
        },
        {
          role: "patient",
          content:
            "Yeah, it's mostly around my menstrual period. No heavy period, no pelvic pain, no breast pain. Since you reminded me, I also wanted to discuss maybe going on Ozempic for obesity.",
        },
      ],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      "English",
      null,
      {
        suppressPhotoRequest: false,
        reason: null,
        matchedScope: null,
      },
    );

    expect(prompt).not.toContain('"chest pain"');
    expect(prompt).not.toContain("NEW CONCERN ACKNOWLEDGMENT (MANDATORY THIS TURN)");
  });

  it("renders a clarification prompt when the patient says the assistant misunderstood them", () => {
    const prompt = buildPrompt(
      "upper abdominal lumps",
      patientProfile,
      [
        {
          role: "assistant",
          content:
            "I noted your concern about chest pain, and I’ll come back to that once we finish discussing the abdominal lump. For the lump itself, does it flatten when you lie down?",
        },
        {
          role: "patient",
          content: "I didn't mention anything about chest pain.",
        },
      ],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      "English",
      null,
      {
        suppressPhotoRequest: false,
        reason: null,
        matchedScope: null,
      },
    );

    expect(prompt).toContain("BACKEND-SELECTED NEXT ACTION: CLARIFY");
    expect(prompt).toContain("clarify unclear response");
    expect(prompt).toContain("ask exactly one concise clarification question");
  });

  it("renders a summary prompt when history confidence stays unsafe after clarification", () => {
    const prompt = buildPrompt(
      "upper abdominal lumps",
      patientProfile,
      [
        {
          role: "assistant",
          content:
            "I noted your concern about chest pain, and I’ll come back to that once we finish discussing the abdominal lump. For the lump itself, does it flatten when you lie down?",
        },
        {
          role: "patient",
          content: "I didn't mention anything about chest pain.",
        },
        {
          role: "assistant",
          content:
            "I'm sorry, I may not be understanding correctly. Could you clarify whether you were only describing the abdominal lumps?",
        },
        {
          role: "patient",
          content: "I didn't mention chest pain. I was talking about the abdominal lumps.",
        },
      ],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      "English",
      null,
      {
        suppressPhotoRequest: false,
        reason: null,
        matchedScope: null,
      },
    );

    expect(prompt).toContain("BACKEND-SELECTED NEXT ACTION: SUMMARIZE NOW");
    expect(prompt).toContain("History confidence dropped below a safe threshold");
    expect(prompt).toContain("Do not ask another routine question");
  });

  it("removes giant workflow and count-pressure prompt sections", () => {
    const prompt = buildPrompt(
      "sore throat",
      patientProfile,
      [{ role: "assistant", content: "Tell me about your sore throat." }],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      "English",
      null,
      {
        suppressPhotoRequest: false,
        reason: null,
        matchedScope: null,
      },
    );

    expect(prompt).not.toContain("12-25 focused questions asked");
    expect(prompt).not.toContain("fixed exhaustive questioning");
    expect(prompt).not.toContain("MANDATORY PRE-QUESTION VALIDATION");
    expect(prompt).not.toContain("Question-count guidance is advisory only");
    expect(prompt).toContain("BACKEND-SELECTED NEXT ACTION:");
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

describe("MVA follow-up prompt guidance", () => {
  it("detects likely MVA follow-up context from chief complaint and ongoing care details", () => {
    expect(
      isLikelyMvaFollowUpContext({
        chiefComplaint: "motor vehicle accident follow up",
        patientBackground: null,
        formSummary: null,
        patientAnswers: [
          "It has been four months since the accident.",
          "I am still going to physio twice a week and taking ibuprofen as needed.",
        ],
      }),
    ).toBe(true);
  });

  it("does not classify an initial MVA assessment as follow-up", () => {
    expect(
      isLikelyMvaFollowUpContext({
        chiefComplaint: "motor vehicle accident",
        patientBackground: null,
        formSummary: null,
        patientAnswers: ["I was rear-ended yesterday and went to the emergency room."],
      }),
    ).toBe(false);
  });

  it("returns open-ended follow-up guidance that avoids first-visit checklists", () => {
    const guidance = getMvaFollowUpPromptSection({
      chiefComplaint: "motor vehicle accident follow up",
      patientBackground: "Four month follow-up after MVA.",
      formSummary: null,
      patientAnswers: [
        "My neck is a bit better but the upper back pain still bothers me.",
        "I am doing rehab twice a week and using Tylenol for pain control.",
      ],
    });

    expect(guidance).toContain("Start with a broad, open-ended follow-up question");
    expect(guidance).toContain("let the patient direct the interview");
    expect(guidance).toContain("Do NOT automatically repeat first-visit/admin questions");
    expect(guidance).toContain("Do NOT automatically ask a broad acute-trauma red-flag bundle");
    expect(guidance).toContain("rehab or therapy attendance and frequency");
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

describe("sensitive photo suppression safeguards", () => {
  it("suppresses female breast rash/lesion/lump photo requests", () => {
    const context = getSensitivePhotoContext({
      sex: "female",
      textBlocks: ["I have a breast rash and a painful lump near my nipple."],
    });
    const turn: InterviewResponse = {
      type: "question",
      question: "Would you like to upload a photo of the breast area?",
      rationale: "Visual inspection can help.",
      requiresPhotoUpload: true,
    };

    const guarded = applySensitivePhotoSuppressionToTurn(turn, context);

    expect(context.suppressPhotoRequest).toBe(true);
    expect(context.matchedScope).toBe("female_breast");
    expect(guarded.type).toBe("question");
    if (guarded.type === "question") {
      expect(guarded.requiresPhotoUpload).toBe(false);
      expect(guarded.question.toLowerCase()).not.toContain("upload");
      expect(guarded.question.toLowerCase()).not.toContain("photo");
    }
  });

  it("suppresses genital/private-area photo requests for any sex", () => {
    const context = getSensitivePhotoContext({
      sex: "male",
      textBlocks: ["I have a rash in my groin and genital area."],
    });
    const turn: InterviewResponse = {
      type: "question",
      question: "Can you send a picture of the affected genital area?",
      rationale: "Assess visible changes.",
      requiresPhotoUpload: false,
    };

    const guarded = applySensitivePhotoSuppressionToTurn(turn, context);

    expect(context.suppressPhotoRequest).toBe(true);
    expect(context.matchedScope).toBe("genital_private");
    expect(isPhotoUploadRequestText(turn.question)).toBe(true);
    expect(guarded.type).toBe("question");
    if (guarded.type === "question") {
      expect(guarded.requiresPhotoUpload).toBe(false);
      expect(guarded.question.toLowerCase()).not.toContain("picture");
    }
  });

  it("does not suppress non-sensitive dermatology photo requests", () => {
    const context = getSensitivePhotoContext({
      sex: "female",
      textBlocks: ["Forearm rash with itching for 2 days."],
    });
    const turn: InterviewResponse = {
      type: "question",
      question: "If you can, please upload a photo of your forearm rash.",
      rationale: "Assess lesion morphology.",
      requiresPhotoUpload: true,
    };

    const guarded = applySensitivePhotoSuppressionToTurn(turn, context);

    expect(context.suppressPhotoRequest).toBe(false);
    expect(guarded).toEqual(turn);
  });
});

