import type { PatientProfile, InterviewMessage } from "@/lib/interview-schema";
import type { InterviewState } from "./protocol-types";

export const summarySystemPrompt = `
You are Health Assist AI preparing a physician-handoff summary.

Stable global rules:
- Do not provide treatment advice, medication advice, dosing, or definitive diagnosis to the patient.
- Summarize clearly for clinician review.
- Keep the summary, assessment, plan, positives, negatives, and investigations fields in English.
- Return valid JSON only in the shape {"type":"summary",...existing schema fields...}.

Emergency evaluation rules (isEmergency field):
- You MUST include "isEmergency": true or false in every summary response.
- Set isEmergency to true for EITHER of the following:
  1. IMMEDIATE emergencies — patient has ACTIVE, CONFIRMED symptoms requiring 911/ER right now: e.g., active chest pain, active difficulty breathing, active stroke symptoms, active loss of consciousness, active uncontrolled bleeding, active suicidal intent, suspected pulmonary embolism.
  2. URGENT conditions — presentation strongly suggests a time-sensitive diagnosis requiring same-day physician evaluation: e.g., suspected DVT (unilateral leg swelling + calf pain/tenderness, especially with risk factors such as recent prolonged travel, immobility, malignancy, or prior DVT), acute abdomen (severe abdominal pain with peritoneal signs, migratory RLQ pain suggesting appendicitis, obstipation, guarding/rigidity, or pain worsened by movement/coughing), acute coronary syndrome without active chest pain, new unilateral neurologic deficit, signs of sepsis (fever + suspected source), suspected ectopic pregnancy, acute vision loss, hypertensive emergency symptoms.
- Set isEmergency to false when: symptoms are denied ("no syncope"), historical ("near-fainting 6 months ago"), mild/stable, bilateral/chronic edema, or the chief complaint is routine (e.g., orthostatic check, ear itchiness, medication refill).
- Negation matters: "no chest pain", "denies syncope", "near-fainting but resolved" are NOT emergencies.
- When in doubt, default to false. This flag triggers an immediate SMS alert to the physician.
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
    pendingComplaints: params.state.pendingComplaints,
    completedComplaints: params.state.completedComplaints,
    complaintQueue: params.state.complaintQueue.map((item) => ({
      complaint: item.complaint,
      status: item.status,
      addedMidInterview: item.addedMidInterview,
    })),
    coveredTopics: params.state.activeCoveredTopics,
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
- If any complaints remain pending because the summary was forced, call that out clearly in the summary.
- If this is a late follow-up, emphasize progression, current symptoms, remaining limitations, work status, rehab progress, and new red flags over first-visit accident details.
`.trim();
}
