import { describe, expect, it } from "vitest";
import { decideNextInterviewStep } from "./next-step";
import { buildInterviewState } from "./state-builder";

const patientProfile = {
  sex: "female",
  age: 32,
  pmh: "Asthma, seasonal allergies.",
  familyHistory: "Mother with hypertension, father with type 2 diabetes.",
  familyDoctor: "Dr. Example",
  currentMedications: "Salbutamol inhaler as needed.",
  allergies: "Penicillin causes hives.",
} as const;

describe("interview controller state", () => {
  it("avoids re-targeting onset when the patient already provided it in an acute sore throat flow", () => {
    const state = buildInterviewState({
      chiefComplaint: "3 days of sore throat",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about the sore throat you've been having." },
        {
          role: "patient",
          content: "It started 3 days ago and I also have mild cough and congestion.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    const step = decideNextInterviewStep(state);

    expect(state.coveredTopics).toContain("duration/onset");
    expect(state.coveredTopics).toContain("associated symptoms");
    expect(step.action).toBe("ask_target");
    expect(step.target?.key).not.toBe("duration_onset");
    expect(step.target?.key).not.toBe("associated_symptoms");
  });

  it("classifies a months-later MVA reassessment as late follow-up", () => {
    const state = buildInterviewState({
      chiefComplaint: "motor vehicle accident follow up",
      patientProfile,
      transcript: [
        { role: "assistant", content: "How have you been doing since the accident?" },
        {
          role: "patient",
          content:
            "It has been four months since the accident. My neck is a bit better but my lower back pain is still 6/10. I am doing physio twice a week.",
        },
      ],
      formSummary: null,
      patientBackground: "Four month follow-up after MVA.",
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.visitStage).toBe("late_follow_up");
    expect(state.protocol.id).toBe("trauma-follow-up");
  });

  it("suppresses first-visit accident reconstruction targets during late MVA follow-up", () => {
    const state = buildInterviewState({
      chiefComplaint: "motor vehicle accident follow up",
      patientProfile,
      transcript: [
        { role: "assistant", content: "How have you been doing since the accident?" },
        {
          role: "patient",
          content:
            "It has been four months since the accident. My neck is improving but my lower back pain is still 6/10. I am still off work and doing physio twice a week.",
        },
      ],
      formSummary: null,
      patientBackground: "Four month follow-up after MVA.",
      forceSummary: false,
      deferredIntentHint: null,
    });

    const step = decideNextInterviewStep(state);

    expect(step.action).toBe("ask_target");
    expect(step.target?.key).not.toBe("accident_details");
    expect(step.target?.key).not.toBe("accident_response");
    expect(step.target?.key).not.toBe("previous_injuries");
  });

  it("does not mark summary ready when acute required fields and red flags are still missing", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat." },
        { role: "patient", content: "It started yesterday." },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.summaryReady).toBe(false);
    expect(state.missingRequiredFields.length).toBeGreaterThan(0);
    expect(state.missingRedFlags.length).toBeGreaterThan(0);
    expect(state.progress.approxTotalQuestions).toBeGreaterThan(state.progress.questionsAsked);
  });

  it("queues a mid-interview complaint and adds the +8 budget modifier without abandoning the active complaint", () => {
    const state = buildInterviewState({
      chiefComplaint: "right knee lump",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about the lump and pain behind your right knee." },
        {
          role: "patient",
          content:
            "It started a month ago. It is aching 7 out of 10 behind my right knee, worse with bending and driving, and better with icing and naproxen.",
        },
        {
          role: "assistant",
          content: "Any other symptoms with the knee, such as locking, giving way, numbness, tingling, color change, inability to bear weight, major swelling, or deformity?",
        },
        {
          role: "patient",
          content: "No to all of those. Also having right elbow pain with lifting or weight-bearing activities.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeComplaint).toBe("right knee lump");
    expect(state.pendingComplaints).toContain("right elbow pain");
    expect(state.newComplaintCount).toBe(1);
    expect(state.questionBudgetModifiers).toContain("+8-new-complaint");
    expect(state.summaryReady).toBe(false);
    expect(state.progress.approxTotalQuestions).toBeGreaterThan(state.totalQuestionCount);
  });

  it("raises the approximate total when a new complaint is added mid-interview", () => {
    const baselineState = buildInterviewState({
      chiefComplaint: "right knee lump",
      patientProfile,
      transcript: [
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
        { role: "patient", content: "No to all of those." },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });
    const expandedState = buildInterviewState({
      chiefComplaint: "right knee lump",
      patientProfile,
      transcript: [
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
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(expandedState.progress.approxTotalQuestions).toBeGreaterThan(
      baselineState.progress.approxTotalQuestions,
    );
  });

  it("queues a diagnosis or lab concern mentioned mid-interview without abandoning the active complaint", () => {
    const state = buildInterviewState({
      chiefComplaint: "prostate issues",
      patientProfile,
      transcript: [
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
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeComplaint).toBe("prostate issues");
    expect(state.pendingComplaints).toContain("blood sugar concern");
    expect(state.newComplaintCount).toBe(1);
    expect(state.questionBudgetModifiers).toContain("+8-new-complaint");
    expect(state.summaryReady).toBe(false);
  });

  it("queues multiple new concerns in order of appearance", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat." },
        {
          role: "patient",
          content: "It started yesterday and it hurts to swallow.",
        },
        {
          role: "assistant",
          content:
            "Have you had fever, trouble breathing, trouble swallowing saliva, rash, or any severe symptoms?",
        },
        {
          role: "patient",
          content:
            "No. Also regarding my blood sugar, I was told I have prediabetes. And I have questions about my blood pressure too.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeComplaint).toBe("sore throat");
    expect(state.pendingComplaints).toEqual(["blood sugar concern", "blood pressure concern"]);
    expect(state.newComplaintCount).toBe(2);
    expect(state.questionBudgetModifiers).toContain("+16-new-complaint");
  });

  it("starts a newly activated queued complaint with an open narrative and keeps coverage complaint-scoped", () => {
    const transcript = [
      { role: "assistant", content: "Tell me about the lump and pain behind your right knee." },
      {
        role: "patient",
        content:
            "It started 1 month ago. It is aching 7 out of 10 behind my right knee, worse with bending and driving, better with icing and naproxen, and I cannot fully flex it.",
      },
      {
        role: "assistant",
        content: "Looking at the diagram/photo of your knee, please mark exactly where the pain is most noticeable.",
      },
      { role: "patient", content: "I marked the painful spot on the right knee diagram." },
      {
        role: "assistant",
        content:
          "Any other symptoms with the knee, such as locking, catching, giving way, numbness, tingling, color change, inability to bear weight, major swelling, or deformity?",
      },
      {
        role: "patient",
        content: "No to all of those. Also having right elbow pain with lifting or weight-bearing activities.",
      },
      {
        role: "assistant",
        content: "Looking at the diagram/photo of your elbow, please mark exactly where the pain is most noticeable.",
      },
      { role: "patient", content: "I marked the painful spot on the elbow diagram." },
      {
        role: "assistant",
        content: "When you touch the area behind the knee, is it tender, and does it feel soft, firm, or hard?",
      },
      { role: "patient", content: "It feels soft and tender." },
      {
        role: "assistant",
        content: "Any redness, warmth, bruising, or swelling around the knee or over the lump?",
      },
      { role: "patient", content: "No redness, warmth, bruising, or swelling." },
    ] as const;

    const state = buildInterviewState({
      chiefComplaint: "right knee lump",
      patientProfile,
      transcript: [...transcript],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });
    const step = decideNextInterviewStep(state);

    expect(state.completedComplaints).toContain("right knee lump");
    expect(state.activeComplaint).toBe("right elbow pain");
    expect(state.activeComplaintQuestionCount).toBe(0);
    expect(state.activeCoveredTopics).not.toContain("severity");
    expect(state.summaryReady).toBe(false);
    expect(step.action).toBe("ask_target");
    expect(step.target?.key).toBe("open_narrative");
  });
});
