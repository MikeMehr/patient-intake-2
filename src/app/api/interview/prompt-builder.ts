import { logDebug } from "@/lib/secure-logger";
import type { InterviewMessage, PatientProfile } from "@/lib/interview-schema";
import type { NextInterviewStep } from "./next-step";
import { decideNextInterviewStep } from "./next-step";
import type { InterviewState } from "./protocol-types";
import type { SensitivePhotoContext } from "./prompt-helpers";
import { buildInterviewState } from "./state-builder";

function formatTranscript(transcript: InterviewMessage[]) {
  return transcript
    .map((message) => `${message.role === "assistant" ? "Assistant" : "Patient"}: ${message.content}`)
    .join("\n");
}

function formatRecentQuestions(questions: string[]) {
  if (questions.length === 0) {
    return "No prior assistant questions.";
  }

  return questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
}

function buildQueuedConcernInstruction(state: InterviewState, transcript: InterviewMessage[]) {
  const lastPatientMessageIndex = (() => {
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      if (transcript[index]?.role === "patient") return index;
    }
    return -1;
  })();

  const newlyQueuedComplaints = state.complaintQueue.filter(
    (item) => item.addedMidInterview && item.firstDetectedAtMessageIndex === lastPatientMessageIndex,
  );
  const newlyBriefSecondaryConcerns = state.briefSecondaryConcerns.filter(
    (item) => item.firstDetectedAtMessageIndex === lastPatientMessageIndex,
  );

  if (newlyQueuedComplaints.length > 0) {
    return `\nNEW CONCERNS TO ACKNOWLEDGE:
- Briefly acknowledge: ${newlyQueuedComplaints.map((item) => `"${item.complaint}"`).join(", ")}.
- Say you will return to ${newlyQueuedComplaints.length === 1 ? "that concern" : "those concerns"} after finishing "${state.activeComplaint}".
- After the acknowledgment, continue only with the backend-selected next step below.`;
  }

  if (newlyBriefSecondaryConcerns.length > 0) {
    return `\nBRIEF SECONDARY CONCERN NOTE:
- Briefly acknowledge: ${newlyBriefSecondaryConcerns.map((item) => `"${item.complaint}"`).join(", ")}.
- Keep any safety check brief, then return to "${state.activeComplaint}".`;
  }

  return "";
}

function buildActionBlock(nextStep: NextInterviewStep, state: InterviewState) {
  switch (nextStep.action) {
    case "clarify":
      return `BACKEND-SELECTED NEXT ACTION: CLARIFY
- Reason: ${nextStep.reason}
- Complaint focus: "${state.activeComplaint}"
- Clarification target: ${nextStep.target?.label ?? "clarify unclear response"}
- Clarification hint: ${nextStep.target?.promptHint ?? state.unresolvedClarification ?? ""}
- Task: Briefly acknowledge the misunderstanding, then ask exactly one concise clarification question. Do not move to a different topic yet.`;
    case "ask_target":
      return `BACKEND-SELECTED NEXT ACTION: ASK ONE TARGETED QUESTION
- Reason: ${nextStep.reason}
- Complaint focus: "${state.activeComplaint}"
- Target category: ${nextStep.target?.category ?? "required_field"}
- Target label: ${nextStep.target?.label ?? "required history item"}
- Clinical rationale: ${nextStep.target?.rationale ?? "Gather the next most important missing history item."}
- Prompt hint: ${nextStep.target?.promptHint ?? ""}
- Task: Ask exactly one patient-facing question that addresses only this selected target. Do not choose a different workflow step on your own.`;
    case "summarize":
    case "escalate":
    default:
      return `BACKEND-SELECTED NEXT ACTION: SUMMARIZE NOW
- Reason: ${nextStep.reason}
- Complaint focus: "${state.activeComplaint}"
- Task: Do not ask another routine question. Provide a physician-handoff summary based only on established history.`;
  }
}

function buildOutputContract(nextStep: NextInterviewStep) {
  if (nextStep.action === "summarize" || nextStep.action === "escalate") {
    return `OUTPUT CONTRACT:
- Return valid JSON only.
- Return a summary object shaped like:
{"type":"summary","positives":["..."],"negatives":["..."],"summary":"...","investigations":["..."],"assessment":"...","plan":["..."]}
- Preserve uncertainty when history is incomplete.
- Do not give treatment or medication advice to the patient.`;
  }

  return `OUTPUT CONTRACT:
- Return valid JSON only.
- Return a question object shaped like:
{"type":"question","question":"...","rationale":"...","requiresPhotoUpload":false}
- Ask exactly one question.
- Keep the rationale brief and clinical.
- Set "requiresPhotoUpload": true only when the question explicitly asks for an image upload.`;
}

export function buildPrompt(
  chiefComplaint: string,
  profile: PatientProfile,
  transcript: InterviewMessage[],
  imageSummary: string | null,
  labReportSummary: string | null,
  previousLabReportSummary: string | null,
  formSummary: string | null,
  interviewGuidance: string | null,
  medPmhSummary: string | null,
  patientBackground: string | null,
  forceSummary: boolean = false,
  languageName: string = "English",
  deferredIntentHint: string | null = null,
  sensitivePhotoContext: SensitivePhotoContext = {
    suppressPhotoRequest: false,
    reason: null,
    matchedScope: null,
  },
  precomputedState?: InterviewState,
  precomputedNextStep?: NextInterviewStep,
): string {
  const interviewState =
    precomputedState ??
    buildInterviewState({
      chiefComplaint,
      patientProfile: profile,
      transcript,
      formSummary,
      patientBackground,
      forceSummary,
      deferredIntentHint,
    });
  const nextStep = precomputedNextStep ?? decideNextInterviewStep(interviewState);

  const recentTranscript = transcript.length > 12 ? transcript.slice(-12) : transcript;
  const recentQuestions = interviewState.allQuestionsAsked.slice(-8);
  const activeFacts = interviewState.activePatientFacts.informationSummary || "No concise fact summary captured yet.";
  const pendingComplaints = interviewState.pendingComplaints.length
    ? interviewState.pendingComplaints.map((complaint) => `- ${complaint}`).join("\n")
    : "None.";
  const completedComplaints = interviewState.completedComplaints.length
    ? interviewState.completedComplaints.map((complaint) => `- ${complaint}`).join("\n")
    : "None.";
  const activeCoveredTopics = interviewState.activeCoveredTopics.length
    ? interviewState.activeCoveredTopics.join(", ")
    : "none yet";
  const imageSection = imageSummary
    ? `PHOTO CONTEXT:\n${imageSummary}\n- A photo has already been reviewed. Acknowledge it only if helpful. Do not ask for another photo unless you truly need one.`
    : "PHOTO CONTEXT:\nNo photo summary provided.";
  const labSection =
    labReportSummary || previousLabReportSummary
      ? `LAB CONTEXT:
${labReportSummary ? `Current summary: ${labReportSummary}` : ""}
${previousLabReportSummary ? `Previous summary: ${previousLabReportSummary}` : ""}
- Use only these provided lab/imaging summaries. Do not invent missing results.`
      : "LAB CONTEXT:\nNo physician-provided lab summary.";
  const formSection = formSummary
    ? `FORM CONTEXT:\n${formSummary}\n- Only gather form details when the backend-selected next step points to them.`
    : "";
  const guidanceSection = interviewGuidance
    ? `PHYSICIAN GUIDANCE:\n${interviewGuidance}`
    : "";
  const medPmhSection = medPmhSummary
    ? `UPLOADED MEDS/PMH CONTEXT:\n${medPmhSummary}`
    : "";
  const patientBackgroundSection = patientBackground
    ? `PHYSICIAN-PROVIDED BACKGROUND:\n${patientBackground}`
    : "";
  const sensitivePhotoDirective = sensitivePhotoContext.suppressPhotoRequest
    ? `SENSITIVE PHOTO OVERRIDE:
- Sensitive area context detected (${sensitivePhotoContext.reason}).
- You must not ask for a photo.
- Set "requiresPhotoUpload": false.`
    : "";

  const fullPrompt = `
You are phrasing one backend-selected interview step for a Physician Assistant.

GLOBAL RULES:
- The backend has already chosen the next workflow action. Do not invent a different workflow step.
- Stay on the active complaint unless the backend-selected action is to summarize.
- Listen carefully to patient corrections and redirections.
- Be natural, concise, and conversational, not checklist-like.
- Avoid repeating or rephrasing recent questions unless the backend-selected action is clarification.
- Do not give treatment advice, medication instructions, or diagnoses to the patient.
- Conduct patient-facing text in ${languageName}. Keep clinician summary fields in English.

ACTIVE COMPLAINT:
- Chief complaint text: "${chiefComplaint}"
- Current active complaint: "${interviewState.activeComplaint}"
- Pending complaints:
${pendingComplaints}
- Completed complaints:
${completedComplaints}
- Active covered topics: ${activeCoveredTopics}
- Active complaint facts:
${activeFacts}
${buildQueuedConcernInstruction(interviewState, transcript)}

PATIENT PROFILE:
- Sex: ${profile.sex}
- Age: ${profile.age}
- Past medical history: ${profile.pmh}
- Family history: ${profile.familyHistory}
- Current medications: ${profile.currentMedications}
- Allergies: ${profile.allergies}
- Family doctor: ${profile.familyDoctor}

${patientBackgroundSection}
${medPmhSection}
${imageSection}
${labSection}
${formSection}
${guidanceSection}
${sensitivePhotoDirective}

RECENT TRANSCRIPT:
${recentTranscript.length > 0 ? formatTranscript(recentTranscript) : "No prior transcript."}

RECENT ASSISTANT QUESTIONS TO AVOID REPEATING:
${formatRecentQuestions(recentQuestions)}

${buildActionBlock(nextStep, interviewState)}

STYLE INSTRUCTIONS:
- If asking a question, ask exactly one question.
- If the selected target is "open narrative", rephrase the complaint naturally instead of repeating it verbatim.
- If clarifying, briefly acknowledge the misunderstanding before asking the clarification question.
- If summarizing, do not ask more questions.
- If multiple complaints exist, do not drift into other complaints beyond the brief acknowledgment instructions above.

${buildOutputContract(nextStep)}
  `.trim();

  logDebug("[buildPrompt] compact prompt metadata", {
    nextAction: nextStep.action,
    activeComplaint: interviewState.activeComplaint,
    promptLength: fullPrompt.length,
  });

  return fullPrompt;
}
