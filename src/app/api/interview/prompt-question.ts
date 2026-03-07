import type { PatientProfile, InterviewMessage } from "@/lib/interview-schema";
import type { InterviewState, NextQuestionTarget } from "./protocol-types";
import type { SensitivePhotoContext } from "./prompt-helpers";

export const questionSystemPrompt = `
You are Health Assist AI conducting a physician-handoff clinical interview.

Stable global rules:
- Keep a calm, empathetic, concise, patient-friendly tone.
- Ask exactly one question.
- Do not provide treatment advice, medication advice, dosing, or definitive diagnosis.
- Clarify unclear responses before moving on when needed.
- Follow the backend controller's nextAllowedTarget exactly.
- Return valid JSON only in the shape {"type":"question","question":"...","rationale":"...","requiresPhotoUpload":false}.
- Keep patient-facing text in the requested interview language. Do not mix languages.
`.trim();

function formatTranscript(transcript: InterviewMessage[]) {
  if (transcript.length === 0) {
    return "Transcript: (empty)";
  }
  return transcript
    .slice(-20)
    .map((message) => `${message.role === "assistant" ? "Assistant" : "Patient"}: ${message.content}`)
    .join("\n");
}

export function buildQuestionPrompt(params: {
  state: InterviewState;
  target: NextQuestionTarget;
  patientProfile: PatientProfile;
  transcript: InterviewMessage[];
  imageSummary: string | null;
  labReportSummary: string | null;
  previousLabReportSummary: string | null;
  formSummary: string | null;
  interviewGuidance: string | null;
  medPmhSummary: string | null;
  patientBackground: string | null;
  languageName: string;
  sensitivePhotoContext: SensitivePhotoContext;
}): string {
  const control = {
    mode: "question",
    activeComplaint: params.state.activeComplaint,
    activeComplaintIndex: params.state.activeComplaintIndex,
    complaintClass: params.state.complaintClass,
    encounterStage: params.state.visitStage,
    pendingComplaints: params.state.pendingComplaints,
    completedComplaints: params.state.completedComplaints,
    complaintQueue: params.state.complaintQueue.map((item) => ({
      complaint: item.complaint,
      status: item.status,
      addedMidInterview: item.addedMidInterview,
    })),
    coveredTopics: params.state.activeCoveredTopics,
    missingRequiredFields: params.state.missingRequiredFields.map((item) => item.label),
    missingRedFlags: params.state.missingRedFlags.map((item) => item.label),
    questionBudget: params.state.questionBudget,
    questionBudgetModifiers: params.state.questionBudgetModifiers,
    urgency: params.state.urgency,
    nextAllowedTarget: params.target,
    photoAllowed:
      !params.sensitivePhotoContext.suppressPhotoRequest && params.state.protocol.photoAppropriate,
  };

  return `
Runtime control object:
${JSON.stringify(control, null, 2)}

Patient context:
${JSON.stringify(
    {
      age: params.patientProfile.age,
      sex: params.patientProfile.sex,
      pmh: params.patientProfile.pmh,
      medications: params.patientProfile.currentMedications,
      allergies: params.patientProfile.allergies,
      familyHistory: params.patientProfile.familyHistory,
      patientBackground: params.patientBackground,
      medPmhSummary: params.medPmhSummary,
      imageSummary: params.imageSummary,
      labReportSummary: params.labReportSummary,
      previousLabReportSummary: params.previousLabReportSummary,
      formSummary: params.formSummary,
      physicianGuidance: params.interviewGuidance,
      language: params.languageName,
      sensitivePhotoOverride: params.sensitivePhotoContext,
    },
    null,
    2,
  )}

Recent transcript:
${formatTranscript(params.transcript)}

Instructions:
- Ask only about nextAllowedTarget.
- Do not ask about any covered topic unless nextAllowedTarget is a clarification.
- For late MVA or MSK follow-up, stay progression-focused and avoid first-visit/admin reconstruction questions unless the target explicitly requires them.
- If nextAllowedTarget.promptHint is present, use it as guidance for phrasing.
- Keep the question concise and natural.
`.trim();
}
