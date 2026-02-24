import type { InterviewResponse } from "@/lib/interview-schema";
import { describe, expect, it } from "vitest";
import {
  POST,
  buildPrompt,
  classifyComplaint,
  detectFatigueSignals,
  getScopedRedFlags,
  systemInstruction,
} from "./route";

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
  it("includes no-treatment guardrails in system prompt", () => {
    expect(systemInstruction).toContain("FORBIDDEN from giving treatment recommendations");
    expect(systemInstruction).toContain("defer treatment decisions to the physician");
    expect(systemInstruction).not.toContain("Make evidence-based lifestyle recommendations");
  });

  it("includes focused questioning policy in system prompt", () => {
    expect(systemInstruction).toContain("INTERVIEW FOCUS POLICY");
    expect(systemInstruction).toContain("Targeted red flag screening only");
    expect(systemInstruction).toContain("Avoid patient fatigue");
  });

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

describe("interview focus controller", () => {
  const makePrompt = (params: {
    chiefComplaint: string;
    transcript?: Array<{ role: "assistant" | "patient"; content: string }>;
    formSummary?: string | null;
  }) =>
    buildPrompt(
      params.chiefComplaint,
      patientProfile,
      params.transcript ?? [],
      null,
      null,
      null,
      params.formSummary ?? null,
      null,
      null,
      null,
      false,
      "English",
    );

  it("uses complaint-scoped red flags", () => {
    const headachePrompt = makePrompt({ chiefComplaint: "severe headache" });
    expect(headachePrompt).toContain("Worst headache of life / thunderclap onset");
    expect(headachePrompt).not.toContain("Inability to weight bear or severe functional loss");

    const anklePrompt = makePrompt({ chiefComplaint: "left ankle pain after twist injury" });
    expect(anklePrompt).toContain("Inability to weight bear or severe functional loss");
    expect(anklePrompt).not.toContain("Worst headache of life / thunderclap onset");
  });

  it("expands depth for escalation and uses unlimited budget with uploaded structured form", () => {
    const prompt = makePrompt({
      chiefComplaint: "car accident neck pain",
      formSummary: "Insurance form requiring claim number and medico-legal details.",
    });
    expect(prompt).toContain("Escalation active: yes");
    expect(prompt).toContain("Question budget: Unlimited (structured physician form uploaded)");
  });

  it("detects fatigue signals and enables early stop", () => {
    const transcript = [
      { role: "assistant" as const, content: "Question 1?" },
      { role: "patient" as const, content: "ok" },
      { role: "assistant" as const, content: "Question 2?" },
      { role: "patient" as const, content: "ok" },
      { role: "assistant" as const, content: "Question 3?" },
      { role: "patient" as const, content: "ok" },
      { role: "assistant" as const, content: "Question 4?" },
      { role: "patient" as const, content: "ok" },
      { role: "assistant" as const, content: "Question 5?" },
      { role: "patient" as const, content: "ok" },
      { role: "assistant" as const, content: "Question 6?" },
      { role: "patient" as const, content: "ok" },
    ];
    const prompt = makePrompt({ chiefComplaint: "mild sore throat", transcript });
    expect(prompt).toContain("Fatigue signals detected: yes");
    expect(prompt).toContain("Early-stop condition: MET");
  });

  it("enforces missing required form items before summary", () => {
    const prompt = makePrompt({
      chiefComplaint: "MVA 2 days ago",
      transcript: [
        {
          role: "patient",
          content:
            "I was rear-ended 2 days ago and have neck and lower back pain. My insurance is ICBC.",
        },
      ],
      formSummary: [
        "Document Type: Form",
        "Items To Clarify With Patient:",
        "- Exact date of accident",
        "- Insurance claim number",
        "- Work duties and specific functional limitations",
      ].join("\n"),
    });

    expect(prompt).toContain("FORM COMPLETION CONTROLLER (MANDATORY)");
    expect(prompt).toContain("Missing required form items to cover before summary");
    expect(prompt).toContain("CRITICAL OVERRIDE: Required form items are still missing.");
    expect(prompt).toContain("Your next response MUST be a {\"type\":\"question\"}");
  });

  it("exports classifier and scoped red flag helpers", () => {
    expect(classifyComplaint("sudden vision loss and weakness")).toBe("Neuro");
    expect(getScopedRedFlags("MSK")).toContain("Inability to weight bear or severe functional loss");
    expect(detectFatigueSignals(["I already answered that", "ok"]).active).toBe(true);
  });
});

