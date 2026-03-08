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
    expect(state.summaryReady).toBe(false);
    expect(state.progress.approxTotalQuestions).toBeGreaterThan(state.totalQuestionCount);
  });

  it("keeps a historical or improving secondary complaint out of the full queue", () => {
    const state = buildInterviewState({
      chiefComplaint: "abdominal pain",
      patientProfile,
      transcript: [
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
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeComplaint).toBe("abdominal pain");
    expect(state.pendingComplaints).toEqual([]);
    expect(state.newComplaintCount).toBe(0);
    expect(state.briefSecondaryConcerns.map((item) => item.complaint)).toContain("headache");
  });

  it("promotes a brief secondary concern into the full queue when the safety answer sounds concerning", () => {
    const state = buildInterviewState({
      chiefComplaint: "abdominal pain",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about the abdominal pain." },
        { role: "patient", content: "It started a month ago and is gradually improving." },
        {
          role: "assistant",
          content: "Did you have any nausea, vomiting, constipation, or other symptoms when it first started?",
        },
        {
          role: "patient",
          content:
            "I went to the ER in February and also experienced a headache, but that was mostly better.",
        },
        {
          role: "assistant",
          content:
            "Since that headache happened, did you have any vision changes, weakness, numbness, trouble speaking, fainting, or a sudden severe headache?",
        },
        {
          role: "patient",
          content: "Yes, it came back and now I have blurry vision with it.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.pendingComplaints).toContain("headache");
    expect(state.newComplaintCount).toBe(1);
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
    expect(state.summaryReady).toBe(false);
  });

  it("queues an abnormal imaging follow-up concern from the first patient reply without duplicating diabetes", () => {
    const state = buildInterviewState({
      chiefComplaint: "type 2 diabetes",
      patientProfile,
      transcript: [
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
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeComplaint).toBe("type 2 diabetes");
    expect(state.pendingComplaints).toEqual(["liver function concern"]);
    expect(state.complaintQueue.map((item) => item.complaint)).not.toContain("blood sugar concern");
    expect(state.newComplaintCount).toBe(1);
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
  });

  it("does not synthesize chest pain from a negated breast-pain mention when another concern is introduced", () => {
    const state = buildInterviewState({
      chiefComplaint: "upper abdominal lumps",
      patientProfile,
      transcript: [
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
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.pendingComplaints).not.toContain("chest pain");
    expect(state.complaintQueue.map((item) => item.complaint)).not.toContain("chest pain");
    expect(state.newComplaintCount).toBe(0);
  });

  it("treats explicit patient corrections as unresolved clarification", () => {
    const state = buildInterviewState({
      chiefComplaint: "upper abdominal lumps",
      patientProfile,
      transcript: [
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
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    const step = decideNextInterviewStep(state);

    expect(state.unresolvedClarification).toContain("didn't mention");
    expect(step.action).toBe("clarify");
    expect(step.target?.key).toBe("clarify_last_response");
  });

  it("treats repeated denial of the active complaint as a clarification and then early-stop signal", () => {
    const clarificationState = buildInterviewState({
      chiefComplaint: "abdominal pain",
      patientProfile,
      transcript: [
        {
          role: "assistant",
          content: "Can you tell me what’s been going on with your abdominal pain?",
        },
        {
          role: "patient",
          content: "I am not having abdominal pain. This is actually a follow-up about ultrasound results.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(clarificationState.unresolvedClarification).toContain("denying abdominal pain");
    expect(decideNextInterviewStep(clarificationState).action).toBe("clarify");

    const summaryState = buildInterviewState({
      chiefComplaint: "abdominal pain",
      patientProfile,
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
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(summaryState.shouldEndEarlyForUnclearHistory).toBe(true);
    expect(decideNextInterviewStep(summaryState).action).toBe("summarize");
  });

  it("ends early when clarification has already been attempted and history confidence stays unsafe", () => {
    const state = buildInterviewState({
      chiefComplaint: "upper abdominal lumps",
      patientProfile,
      transcript: [
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
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    const step = decideNextInterviewStep(state);

    expect(state.historyConfidence).toBe("unsafe_to_continue");
    expect(state.clarificationAttemptCount).toBeGreaterThanOrEqual(1);
    expect(state.shouldEndEarlyForUnclearHistory).toBe(true);
    expect(step.action).toBe("summarize");
  });

  it("summarizes instead of drilling when the patient repeatedly redirects to a queued concern", () => {
    const state = buildInterviewState({
      chiefComplaint: "type 2 diabetes follow-up",
      patientProfile,
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
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    const step = decideNextInterviewStep(state);

    expect(state.pendingComplaints).toContain("liver function concern");
    expect(state.repeatedPendingConcernRedirectCount).toBeGreaterThanOrEqual(2);
    expect(state.shouldSummarizeAfterRepeatedRedirection).toBe(true);
    expect(step.action).toBe("summarize");
  });

  it("allows straightforward complaints to complete without hitting a numeric question floor", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat." },
        {
          role: "patient",
          content:
            "It started 3 days ago, is moderate, hurts when I swallow, and I also have mild congestion but no trouble breathing.",
        },
        {
          role: "assistant",
          content:
            "Have you had fever, trouble swallowing saliva, shortness of breath, weakness, numbness, or any other severe symptoms?",
        },
        {
          role: "patient",
          content: "No fever, no rash, no chest pain, and no trouble swallowing saliva.",
        },
        {
          role: "assistant",
          content: "Any shortness of breath, weakness, or numbness, and what makes it better or worse?",
        },
        {
          role: "patient",
          content: "No shortness of breath, weakness, or numbness. Warm tea helps and swallowing makes it worse.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.summaryReady).toBe(true);
    expect(state.historyConfidence).toBe("clear");
    expect(state.activeComplaintQuestionCount).toBeLessThan(5);
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
