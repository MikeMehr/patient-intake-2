import type { PatientProfile, InterviewMessage } from "@/lib/interview-schema";
import type { InterviewState } from "./protocol-types";

export const summarySystemPrompt = `
You are Health Assist AI preparing a physician-handoff summary.

Stable global rules:
- Do not provide treatment advice, medication advice, dosing, or definitive diagnosis to the patient.
- Summarize clearly for clinician review.
- Keep the summary, assessment, plan, positives, negatives, and investigations fields in English.
- Return valid JSON only in the shape {"type":"summary",...existing schema fields...}.
`.trim();

function formatTranscript(transcript: InterviewMessage[]) {
  if (transcript.length === 0) {
    return "Transcript: (empty)";
  }
  return transcript
    .slice(-30)
    .map((message) => `${message.role === "assistant" ? "Assistant" : "Patient"}: ${message.content}`)
    .join("\n");
}

export function buildSummaryPrompt(params: {
  state: InterviewState;
  patientProfile: PatientProfile;
  transcript: InterviewMessage[];
  imageSummary: string | null;
  labReportSummary: string | null;
  previousLabReportSummary: string | null;
  formSummary: string | null;
  interviewGuidance: string | null;
  medPmhSummary: string | null;
  patientBackground: string | null;
}): string {
  const control = {
    mode: "summary",
    chiefComplaint: params.state.chiefComplaint,
    activeComplaint: params.state.activeComplaint,
    complaintClass: params.state.complaintClass,
    encounterStage: params.state.visitStage,
    completedComplaints: params.state.completedComplaints,
    coveredTopics: params.state.coveredTopics,
    patientFacts: params.state.patientFacts,
    summaryReason: params.state.forceSummary ? "patient_requested_end" : "controller_ready",
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
    },
    null,
    2,
  )}

Recent transcript:
${formatTranscript(params.transcript)}

Instructions:
- Produce the existing summary JSON schema only.
- Keep the plan focused on physician handoff and follow-up, not treatment advice.
- Include concise differentials in assessment without sounding definitive.
- If this is a late follow-up, emphasize progression, current symptoms, remaining limitations, work status, rehab progress, and new red flags over first-visit accident details.
`.trim();
}
