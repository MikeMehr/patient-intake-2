import { logDebug } from "@/lib/secure-logger";
import type { InterviewMessage, PatientProfile } from "@/lib/interview-schema";
import type { InterviewState } from "./protocol-types";
import {
  getMvaAdminPromptSection,
  type SensitivePhotoContext,
} from "./prompt-helpers";
import { buildInterviewState } from "./state-builder";
import { getBodyDiagramPromptSection } from "@/lib/body-diagram-images";

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
- After the acknowledgment, continue with the next appropriate question.`;
  }

  if (newlyBriefSecondaryConcerns.length > 0) {
    return `\nBRIEF SECONDARY CONCERN NOTE:
- Briefly acknowledge: ${newlyBriefSecondaryConcerns.map((item) => `"${item.complaint}"`).join(", ")}.
- Keep any safety check brief, then return to "${state.activeComplaint}".`;
  }

  return "";
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
    ? `FORM CONTEXT:\n${formSummary}\n- Gather form details when relevant to the complaint.`
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

  const bodyDiagramSection = getBodyDiagramPromptSection(
    profile.sex === "male" ? "male" : profile.sex === "female" ? "female" : undefined,
  );

  const mvaAdminSection = getMvaAdminPromptSection(chiefComplaint);

  const taskInstruction = forceSummary
    ? "Provide a physician-handoff summary based on the established history. Do not ask another question."
    : "Either (a) ask the next most appropriate question to continue gathering history, or (b) provide a physician-handoff summary if the history is sufficient for handoff.";

  const fullPrompt = `
You are a Physician Assistant conducting a medical history. You decide what to ask next and when the history is sufficient to summarize. Do not provide treatment recommendations, medication instructions, dosing advice, or diagnosis to the patient.

RULES:
- Be natural and concise. You may group related questions together to ask fewer questions. This reduces patient fatigue.
- Conduct patient-facing text in ${languageName}. Keep clinician summary fields in English.
- Stay on the active complaint unless the patient redirects.
- Listen carefully to patient corrections and redirections.
- As much as possible, make it feel like a physician-assistant–patient conversation.

TASK: ${taskInstruction}

ACTIVE COMPLAINT:
- Chief complaint text: "${chiefComplaint}"
- Current active complaint: "${interviewState.activeComplaint}"
- Pending complaints:
${pendingComplaints}
- Completed complaints:
${completedComplaints}
- Active covered topics (for reference): ${activeCoveredTopics}
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

${bodyDiagramSection}
${mvaAdminSection}

RECENT TRANSCRIPT:
${recentTranscript.length > 0 ? formatTranscript(recentTranscript) : "No prior transcript."}

RECENT ASSISTANT QUESTIONS TO AVOID REPEATING:
${formatRecentQuestions(recentQuestions)}

PROGRESS (you control the patient-facing progress bar; use these values exactly):
- Assistant question prompts asked so far: ${interviewState.allQuestionsAsked.length}. Each assistant message = 1 question (do NOT count bullet points or sub-questions within a message).
- progress.questionsAsked = ${interviewState.allQuestionsAsked.length} (the count above; do NOT include the current question if type is "question").
- progress.approxTotalQuestions = when type is "summary", set equal to questionsAsked (interview complete). When type is "question", your estimate of total question prompts this interview will need (typically 5-15; consider how much history is gathered, complaint complexity, and pending topics). Count in question prompts (assistant turns), not bullet points.

OUTPUT CONTRACT:
- Return valid JSON only. Include "progress" in every response to drive the patient-facing progress bar.
- If asking a question: {"type":"question","question":"...","rationale":"...","requiresPhotoUpload":false,"requiresLocationMarking":false,"progress":{"questionsAsked":N,"approxTotalQuestions":M}}
  - Ask one or more related questions when grouping flows naturally.
  - When asking multiple questions in a single turn, number each question (1., 2., 3., etc.) and place each on its own line for clarity. Maximum 3 questions per turn. For example: "1. How severe is the pain on a scale of 0-10?\n2. Does it stay in one place or spread elsewhere?\n3. Have you noticed any other symptoms?"
  - Keep the rationale brief and clinical.
  - Set "requiresPhotoUpload": true only when the question explicitly asks for an image upload.
  - Set "requiresLocationMarking": true when the question asks the patient to mark the location on a body diagram AND you can supply a non-empty "locationBodyParts" array. If you cannot identify a specific diagram to show, do NOT use "requiresLocationMarking": true and do NOT reference the diagram in the question text.
  - Optionally include "newComplaints" (string array) when the patient's last message introduces a clearly NEW, affirmatively stated complaint not already listed in active or pending complaints. Only include complaints the patient affirms they currently have. Do NOT include: denied symptoms ("no chest pain"), symptoms reported about others, resolved conditions, or vague references. Omit "newComplaints" entirely if nothing new was introduced.
- If providing a summary: {"type":"summary","positives":["..."],"negatives":["..."],"summary":"...","investigations":["..."],"assessment":"...","plan":["..."],"progress":{"questionsAsked":N,"approxTotalQuestions":N}}
  - Preserve uncertainty when history is incomplete.
  - Do not give treatment or medication advice to the patient.
  `.trim();

  logDebug("[buildPrompt] LLM-led prompt metadata", {
    activeComplaint: interviewState.activeComplaint,
    forceSummary,
    promptLength: fullPrompt.length,
  });

  return fullPrompt;
}
