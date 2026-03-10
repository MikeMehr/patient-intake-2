import { describe, expect, it } from "vitest";
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
  it("captures duration/onset and associated symptoms when patient provides them in acute sore throat flow", () => {
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

    expect(state.coveredTopics).toContain("duration/onset");
    expect(state.coveredTopics).toContain("associated symptoms");
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
    expect(state.protocol.id).toBe("sore-throat-uri");
    expect(state.missingRequiredFields.length).toBeGreaterThan(0);
    expect(state.missingRequiredFields.map((field) => field.key)).toContain("throat_red_flags_screen");
    expect(state.progress.approxTotalQuestions).toBeGreaterThan(state.progress.questionsAsked);
  });

  it("uses the sore throat protocol and tracks throat red-flag screen in missing fields", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat." },
        {
          role: "patient",
          content: "It started 2 days ago, is 6 out of 10, and I have congestion and a mild cough.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("sore-throat-uri");
    expect(state.missingRequiredFields.map((f) => f.key)).toContain("throat_red_flags_screen");
  });

  it("keeps sore throat with cough and congestion as one compact URI complaint", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat and cough",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat and cough." },
        {
          role: "patient",
          content:
            "It started 3 days ago with mild sore throat, cough, and congestion, and I can drink liquids with no breathing trouble.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.complaints).toEqual(["sore throat and cough"]);
    expect(state.pendingComplaints).toEqual([]);
    expect(state.protocol.id).toBe("sore-throat-uri");
  });

  it("stops early for a straightforward sore throat once focused core history is covered", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat." },
        {
          role: "patient",
          content:
            "It started 3 days ago, is 5 out of 10, with cough and congestion but no drooling, no trouble breathing, and no trouble swallowing liquids.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("sore-throat-uri");
    expect(state.summaryReady).toBe(true);
    expect(state.activeComplaintQuestionCount).toBeLessThanOrEqual(1);
  });

  it("keeps infectious context in missing fields when fever is present without URI symptoms", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat." },
        {
          role: "patient",
          content:
            "It started 2 days ago, is 7 out of 10, with fever and painful swallowing, but no cough, no runny nose, no drooling, no trouble breathing, and no muffled voice.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("sore-throat-uri");
    expect(state.missingRequiredFields.map((f) => f.key)).toContain("infectious_context");
  });

  it("stops early for a coherent viral URI story without reopening a cough narrative", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat and cough",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat and cough." },
        {
          role: "patient",
          content:
            "It started 3 days ago, is mild, with cough and congestion, and I can drink liquids with no drooling or breathing trouble.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.summaryReady).toBe(true);
    expect(state.pendingComplaints).toEqual([]);
  });

  it("keeps mild viral sore throat short after one focused URI follow-up", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat." },
        {
          role: "patient",
          content:
            "It started 3 days ago, is mild, and I have cough and congestion but no drooling, no trouble breathing, and I can drink liquids.",
        },
        {
          role: "assistant",
          content:
            "Have you had any fever, sick contacts, or noticed white spots or swollen tonsils in your throat?",
        },
        {
          role: "patient",
          content: "No fever, no sick contacts, and I have not seen white spots.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.summaryReady).toBe(true);
    expect(state.activeComplaintQuestionCount).toBeLessThanOrEqual(2);
  });

  it("still prioritizes rapid escalation for sore throat red flags", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat." },
        {
          role: "patient",
          content:
            "It started today, is severe, and I have drooling with trouble breathing and trouble swallowing liquids.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("sore-throat-uri");
    expect(state.activePatientFacts.redFlagsMentioned.length).toBeGreaterThan(0);
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

  it("uses the abdominal pain protocol and prioritizes urgent abdominal screening early", () => {
    const state = buildInterviewState({
      chiefComplaint: "abdominal pain",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about the abdominal pain." },
        {
          role: "patient",
          content: "It is right lower abdominal pain since yesterday, 7 out of 10, with some nausea.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("abdominal-pain");
    expect(state.missingRequiredFields.map((f) => f.key)).toContain("abdominal_red_flags_screen");
  });

  it("does not require pregnancy context for a male abdominal pain history", () => {
    const maleProfile = {
      ...patientProfile,
      sex: "male" as const,
    };
    const state = buildInterviewState({
      chiefComplaint: "abdominal pain",
      patientProfile: maleProfile,
      transcript: [
        { role: "assistant", content: "Tell me about the abdominal pain." },
        {
          role: "patient",
          content:
            "It started yesterday in the lower abdomen, 6 out of 10, with nausea, no urinary symptoms, no vomiting blood, no black stool, and resting helps.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("abdominal-pain");
    expect(state.missingRequiredFields.map((field) => field.key)).not.toContain("pregnancy_context");
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

  it("uses a diabetes-specific follow-up protocol instead of generic acute targets", () => {
    const state = buildInterviewState({
      chiefComplaint: "type 2 diabetes follow-up",
      patientProfile,
      transcript: [
        {
          role: "assistant",
          content: "Tell me how your diabetes has been going lately.",
        },
        {
          role: "patient",
          content: "I was diagnosed 2 years ago, I take metformin regularly, and my A1c was 5.7 last month.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("diabetes-follow-up");
    expect(state.missingRequiredFields.map((field) => field.key)).not.toContain("triggers");
    expect(state.missingRequiredFields.map((field) => field.key)).not.toContain("relieving_factors");
    expect(state.missingRequiredFields.map((field) => field.key)).toContain("diabetes_red_flags_screen");
  });

  it("routes DM2 f/u directly into the diabetes follow-up protocol", () => {
    const state = buildInterviewState({
      chiefComplaint: "DM2 f/u",
      patientProfile,
      transcript: [],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeComplaint).toBe("type 2 diabetes follow-up");
    expect(state.protocol.id).toBe("diabetes-follow-up");
    expect(state.complaintClarificationHint).toBeNull();
    expect(state.missingRequiredFields.map((f) => f.key)).toContain("open_narrative");
  });

  it("routes T2DM follow-up directly into the diabetes follow-up protocol", () => {
    const state = buildInterviewState({
      chiefComplaint: "T2DM follow-up",
      patientProfile,
      transcript: [],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeComplaint).toBe("type 2 diabetes follow-up");
    expect(state.protocol.id).toBe("diabetes-follow-up");
    expect(state.complaintClarificationHint).toBeNull();
  });

  it("treats spelled-out diabetes duration as diagnosis timeline coverage", () => {
    const state = buildInterviewState({
      chiefComplaint: "type 2 diabetes follow-up",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me how your diabetes has been going lately." },
        {
          role: "patient",
          content:
            "Overall it has been well controlled. I was diagnosed about five years ago, take metformin regularly, and my A1C was 5.7.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeCoveredTopics).toContain("duration/onset");
    expect(state.missingRequiredFields.map((field) => field.key)).not.toContain("duration_onset");
  });

  it("treats season-year diabetes diagnosis as timeline coverage", () => {
    const state = buildInterviewState({
      chiefComplaint: "type 2 diabetes follow-up",
      patientProfile,
      transcript: [
        { role: "assistant", content: "When were you first diagnosed with type 2 diabetes?" },
        { role: "patient", content: "I think it was summer 2021." },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeCoveredTopics).toContain("duration/onset");
    expect(state.missingRequiredFields.map((field) => field.key)).not.toContain("duration_onset");
  });

  it("treats month-year diabetes diagnosis as timeline coverage", () => {
    const state = buildInterviewState({
      chiefComplaint: "type 2 diabetes follow-up",
      patientProfile,
      transcript: [
        { role: "assistant", content: "When were you first diagnosed with type 2 diabetes?" },
        { role: "patient", content: "June 2021." },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeCoveredTopics).toContain("duration/onset");
    expect(state.missingRequiredFields.map((field) => field.key)).not.toContain("duration_onset");
  });

  it("stops early for stable diabetes follow-up once focused control and red-flag history are covered", () => {
    const state = buildInterviewState({
      chiefComplaint: "type 2 diabetes follow-up",
      patientProfile,
      transcript: [
        {
          role: "assistant",
          content: "Tell me how your diabetes has been going lately.",
        },
        {
          role: "patient",
          content:
            "I was diagnosed 2 years ago, take metformin regularly, my A1c was 5.7 last month, and I have had no low blood sugar, no increased thirst, no vomiting, no confusion, and no foot wounds.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("diabetes-follow-up");
    expect(state.summaryReady).toBe(true);
    expect(state.activeComplaintQuestionCount).toBeLessThanOrEqual(1);
  });

  it("summarizes stable diabetes very early after a rich first answer for DM2 follow-up", () => {
    const state = buildInterviewState({
      chiefComplaint: "DM2 f/u",
      patientProfile,
      transcript: [
        {
          role: "assistant",
          content:
            "Can you tell me how your diabetes has been going since your last check, including any concerns or changes you've noticed?",
        },
        {
          role: "patient",
          content:
            "My diabetes has been overall well controlled for 5 years. My last A1C was 5.9 two months ago. I take metformin 1000 mg twice a day regularly. I check my blood sugar once or twice a week and fasting is usually 5.5 to 6. I have no low blood sugar, no thirst, no vomiting, no confusion, and no foot wounds.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("diabetes-follow-up");
    expect(state.summaryReady).toBe(true);
    expect(state.activeComplaintQuestionCount).toBeLessThanOrEqual(1);
  });

  it("does not keep targeting diagnosis timeline after natural-language diabetes history answers", () => {
    const state = buildInterviewState({
      chiefComplaint: "type 2 diabetes follow-up",
      patientProfile,
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
            "I was diagnosed about five years ago. Initially, my blood sugar was high, but it has come down, and in the last few years it has been really good. I was wondering if I should get another blood test.",
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
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeCoveredTopics).toContain("duration/onset");
    expect(state.missingRequiredFields.map((f) => f.key)).not.toContain("duration_onset");
  });

  it("captures refill need as a handoff item without prolonging stable diabetes follow-up", () => {
    const state = buildInterviewState({
      chiefComplaint: "T2DM follow-up",
      patientProfile,
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
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("diabetes-follow-up");
    expect(state.activeHandoffNeeds.join(" ").toLowerCase()).toContain("metformin");
    expect(state.activePatientFacts.informationSummary).toContain("running out of metformin");
    expect(state.summaryReady).toBe(true);
  });

  it("does not recycle repeated negative diabetes domains once they were already answered", () => {
    const state = buildInterviewState({
      chiefComplaint: "type 2 diabetes follow-up",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me how your diabetes has been going lately." },
        {
          role: "patient",
          content:
            "I was diagnosed 5 years ago, take metformin regularly, my A1C was 5.9 two months ago, and fasting sugars are 5.5 to 6.",
        },
        {
          role: "assistant",
          content:
            "Have you noticed any numbness or tingling in your feet, any vision changes, or any slow-healing sores or infections?",
        },
        {
          role: "patient",
          content: "No numbness, no vision changes, and no sores or infections.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeCoveredTopics).toContain("diabetes neuropathy");
    expect(state.activeCoveredTopics).toContain("diabetes vision");
    expect(state.activeCoveredTopics).toContain("diabetes sores/infections");
    expect(state.summaryReady).toBe(true);
  });

  it("normalizes mid-interview diabetes shorthand concerns into the diabetes follow-up path", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat." },
        {
          role: "patient",
          content: "It started yesterday and hurts to swallow. Also DM2 f/u and I need my sugars reviewed.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.pendingComplaints).toContain("blood sugar concern");
  });

  it("uses minimal-handoff protocol and sets clarification hint for unclear shorthand", () => {
    const state = buildInterviewState({
      chiefComplaint: "xyz f/u",
      patientProfile,
      transcript: [],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("minimal-handoff");
    expect(state.complaintClarificationHint).toContain("xyz f/u");
  });

  it("uses minimal-handoff protocol after one unclear shorthand clarification", () => {
    const state = buildInterviewState({
      chiefComplaint: "xyz f/u",
      patientProfile,
      transcript: [
        {
          role: "assistant",
          content:
            'I want to make sure I understood you correctly. Could you clarify what "xyz f/u" refers to so I can focus on the right concern?',
        },
        { role: "patient", content: "I'm not sure." },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.protocol.id).toBe("minimal-handoff");
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

  it("branches cough separately only when it appears later as a distinct new concern", () => {
    const state = buildInterviewState({
      chiefComplaint: "sore throat",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your sore throat." },
        {
          role: "patient",
          content:
            "It started 2 days ago, is moderate, and I have no trouble swallowing liquids or breathing.",
        },
        {
          role: "assistant",
          content: "Any cough, congestion, or runny nose with it?",
        },
        {
          role: "patient",
          content:
            "No URI symptoms with the sore throat. Also now having a separate cough for 3 weeks.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.complaints).toContain("cough");
    expect(state.newComplaintCount).toBeGreaterThanOrEqual(1);
    expect(state.activeComplaint).toBe("cough");
    expect(state.missingRequiredFields.length).toBeGreaterThan(0);
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

    expect(state.unresolvedClarification).toContain("didn't mention");
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

    expect(state.historyConfidence).toBe("unsafe_to_continue");
    expect(state.clarificationAttemptCount).toBeGreaterThanOrEqual(1);
    expect(state.shouldEndEarlyForUnclearHistory).toBe(true);
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

    expect(state.pendingComplaints).toContain("liver function concern");
    expect(state.repeatedPendingConcernRedirectCount).toBeGreaterThanOrEqual(2);
    expect(state.shouldSummarizeAfterRepeatedRedirection).toBe(true);
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
    expect(state.completedComplaints).toContain("right knee lump");
    expect(state.activeComplaint).toBe("right elbow pain");
    expect(state.activeComplaintQuestionCount).toBe(0);
    expect(state.activeCoveredTopics).not.toContain("severity");
    expect(state.summaryReady).toBe(false);
    expect(state.missingRequiredFields.length).toBeGreaterThan(0);
  });

  it("tracks duration_onset and combinable fields in missing required fields for knee pain", () => {
    const state = buildInterviewState({
      chiefComplaint: "2 days of right knee pain",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about the knee pain you have been having." },
        { role: "patient", content: "I have pain in my right knee." },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.missingRequiredFields.map((f) => f.key)).toContain("duration_onset");
    const durationIdx = state.missingRequiredFields.findIndex((f) => f.key === "duration_onset");
    expect(durationIdx).toBeGreaterThanOrEqual(0);
  });

  it("marks multiple topics covered when patient answers a combined question", () => {
    const state = buildInterviewState({
      chiefComplaint: "right elbow pain",
      patientProfile,
      transcript: [
        { role: "assistant", content: "Tell me about your elbow pain." },
        { role: "patient", content: "It is in my right elbow." },
        {
          role: "assistant",
          content:
            "How long have you had the pain, how severe is it, and what makes it worse?",
        },
        {
          role: "patient",
          content:
            "About 3 days, it is moderate maybe 5 out of 10, and bending or lifting makes it worse.",
        },
      ],
      formSummary: null,
      patientBackground: null,
      forceSummary: false,
      deferredIntentHint: null,
    });

    expect(state.activeCoveredTopics).toContain("duration/onset");
    expect(state.activeCoveredTopics).toContain("severity");
    expect(state.activeCoveredTopics).toContain("triggers");
  });
});
