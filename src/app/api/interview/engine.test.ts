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
  });
});
