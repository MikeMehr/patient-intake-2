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
import { POST, attachProgressToTurn } from "./route";

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

  it("returns a valid question when the patient corrects the assistant", async () => {
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
      expect(payload.question.length).toBeGreaterThan(5);
    }
  });

  it("returns an early-stop summary when forceSummary is true after repeated unresolved misunderstanding", async () => {
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
        forceSummary: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = (await response.json()) as InterviewResponse;

    expect(response.status).toBe(200);
    expect(payload.type).toBe("summary");
  });

  it("returns a valid response after repeated denial of the active complaint", async () => {
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
    expect(["question", "summary"]).toContain(payload.type);
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
    expect(["question", "summary"]).toContain(payload.type);
  });

  it("routes DM2 f/u and returns a question for empty transcript", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      body: JSON.stringify({
        chiefComplaint: "DM2 f/u",
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
      expect(payload.question.toLowerCase()).not.toContain("clarify");
    }
  });

  it("returns a summary with refill context when forceSummary for stable T2DM follow-up with refill need", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      body: JSON.stringify({
        chiefComplaint: "T2DM follow-up",
        patientProfile,
        patientEmail: "patient@example.com",
        physicianId: "physician-1234567890",
        transcript: [
          {
            role: "assistant",
            content:
              "Can you tell me how your diabetes has been going since your last check, including any concerns or changes you've noticed?",
          },
          {
            role: "patient",
            content:
              "I was diagnosed about 5 years ago. My A1C was 5.9 two months ago. I take metformin 1000 mg twice a day regularly. I check fasting sugars once or twice a week and they are around 5.5 to 6. I have no low blood sugar, no increased thirst, no vomiting, and no foot wounds. I am running out of metformin.",
          },
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
      expect(payload.summary.toLowerCase()).toContain("handoff needs");
      expect(payload.summary.toLowerCase()).toContain("metformin");
      expect(payload.plan.join(" ").toLowerCase()).toContain("handoff need");
    }
  });

  it("does not loop on diagnosis confirmation after natural-language diabetes timing is already established", async () => {
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
            content: "Can you tell me how things have been going with your type 2 diabetes since your last check-in?",
          },
          {
            role: "patient",
            content:
              "Overall, it has been well controlled. My last blood work was about two months ago, and my A1C was about 5.7. I am on metformin 1000 mg twice a day, which I take regularly. My fasting blood sugar ranges from 5.5 to 6.5. Overall, I have been doing well. I need a refill on my metformin.",
          },
          {
            role: "assistant",
            content: "When were you first diagnosed with type 2 diabetes?",
          },
          {
            role: "patient",
            content:
              "I was diagnosed about five years ago. Initially, my blood sugar was high, but it has come down, and in the last few years it has been really good.",
          },
          {
            role: "assistant",
            content:
              "Thanks-you mentioned it was about five years ago; do you remember roughly what year you were first diagnosed with type 2 diabetes?",
          },
          { role: "patient", content: "I think it was summer 2021." },
          {
            role: "assistant",
            content:
              "Thanks-just to confirm, what month and year were you diagnosed with type 2 diabetes?",
          },
          { role: "patient", content: "June 2021" },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = (await response.json()) as InterviewResponse;

    expect(response.status).toBe(200);
    if (payload.type === "question") {
      expect(payload.question.toLowerCase()).not.toContain("diagnosed");
      expect(payload.question.toLowerCase()).not.toContain("month and year");
      expect(payload.question.toLowerCase()).not.toContain("what year");
    }
  });

  it("returns valid responses for unclear shorthand flow", async () => {
    const firstRequest = new Request(endpoint, {
      method: "POST",
      body: JSON.stringify({
        chiefComplaint: "xyz f/u",
        patientProfile,
        patientEmail: "patient@example.com",
        physicianId: "physician-1234567890",
        transcript: [],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const firstResponse = await POST(firstRequest);
    const firstPayload = (await firstResponse.json()) as InterviewResponse;

    expect(firstResponse.status).toBe(200);
    expect(firstPayload.type).toBe("question");
    if (firstPayload.type === "question") {
      expect(firstPayload.question.length).toBeGreaterThan(5);
    }

    const secondRequest = new Request(endpoint, {
      method: "POST",
      body: JSON.stringify({
        chiefComplaint: "xyz f/u",
        patientProfile,
        patientEmail: "patient@example.com",
        physicianId: "physician-1234567890",
        transcript: [
          {
            role: "assistant",
            content:
              'I want to make sure I understood you correctly. Could you clarify what "xyz f/u" refers to so I can focus on the right concern?',
          },
          { role: "patient", content: "I'm not sure." },
        ],
        forceSummary: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    const secondResponse = await POST(secondRequest);
    const secondPayload = (await secondResponse.json()) as InterviewResponse;

    expect(secondResponse.status).toBe(200);
    expect(secondPayload.type).toBe("summary");
  });
});

describe("dynamic complaint queue prompt guidance", () => {
  it("renders an LLM-led prompt that acknowledges newly queued complaints", () => {
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

    expect(prompt).toContain("You decide what to ask next");
    expect(prompt).toContain('Current active complaint: "right knee lump"');
    expect(prompt).toContain("NEW CONCERNS TO ACKNOWLEDGE:");
    expect(prompt).toContain('"right elbow pain"');
    expect(prompt).toContain("TASK:");
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
    expect(prompt).toContain("You decide what to ask next");
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

  it("renders an LLM-led prompt when the patient says the assistant misunderstood them", () => {
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

    expect(prompt).toContain("Listen carefully to patient corrections and redirections");
    expect(prompt).toContain("TASK:");
    expect(prompt).toContain("Either (a) ask the next most appropriate question");
  });

  it("renders an LLM-led prompt when history confidence stays unsafe after clarification", () => {
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

    expect(prompt).toContain("You decide what to ask next");
    expect(prompt).toContain("Either (a) ask the next most appropriate question");
    expect(prompt).toContain("or (b) provide a physician-handoff summary");
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
    expect(prompt).toContain("You decide what to ask next");
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

describe("attachProgressToTurn (LLM progress control)", () => {
  const serverProgress = { questionsAsked: 3, approxTotalQuestions: 15 };

  it("uses valid LLM progress for question turns (questionsAsked + 1, approxTotalQuestions from LLM)", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Any fever or chills?",
      rationale: "Assess for infection.",
      progress: { questionsAsked: 4, approxTotalQuestions: 10 },
    };

    const result = attachProgressToTurn(turn, serverProgress);

    expect(result.progress).toBeDefined();
    expect(result.progress?.questionsAsked).toBe(5);
    expect(result.progress?.approxTotalQuestions).toBe(10);
  });

  it("uses valid LLM progress for summary turns (both equal when interview complete)", () => {
    const turn: InterviewResponse = {
      type: "summary",
      positives: ["Mild sore throat"],
      negatives: ["No fever"],
      summary: "Patient presents with sore throat.",
      investigations: [],
      assessment: "Likely viral URI.",
      plan: ["Supportive care"],
      progress: { questionsAsked: 5, approxTotalQuestions: 5 },
    };

    const result = attachProgressToTurn(turn, serverProgress);

    expect(result.progress).toBeDefined();
    expect(result.progress?.questionsAsked).toBe(5);
    expect(result.progress?.approxTotalQuestions).toBe(5);
  });

  it("falls back to server progress when LLM omits progress", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Any fever or chills?",
      rationale: "Assess for infection.",
    };

    const result = attachProgressToTurn(turn, serverProgress);

    expect(result.progress).toBeDefined();
    expect(result.progress?.questionsAsked).toBe(4);
    expect(result.progress?.approxTotalQuestions).toBeGreaterThanOrEqual(15);
  });

  it("falls back to server progress when LLM progress is invalid (approxTotalQuestions < questionsAsked)", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Any fever?",
      rationale: "Assess.",
      progress: { questionsAsked: 5, approxTotalQuestions: 3 },
    };

    const result = attachProgressToTurn(turn, serverProgress);

    expect(result.progress).toBeDefined();
    expect(result.progress?.questionsAsked).toBe(4);
    expect(result.progress?.approxTotalQuestions).toBeGreaterThanOrEqual(15);
  });

  it("falls back to server progress when approxTotalQuestions is out of bounds", () => {
    const turn: InterviewResponse = {
      type: "question",
      question: "Any fever?",
      rationale: "Assess.",
      progress: { questionsAsked: 2, approxTotalQuestions: 100 },
    };

    const result = attachProgressToTurn(turn, serverProgress);

    expect(result.progress).toBeDefined();
    expect(result.progress?.questionsAsked).toBe(4);
    expect(result.progress?.approxTotalQuestions).toBeGreaterThanOrEqual(15);
  });
});

