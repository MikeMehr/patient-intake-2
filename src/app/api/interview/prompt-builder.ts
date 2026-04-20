import { logDebug } from "@/lib/secure-logger";
import type { InterviewMessage, PatientProfile } from "@/lib/interview-schema";
import type { InterviewState } from "./protocol-types";
import {
  getMvaAdminPromptSection,
  type SensitivePhotoContext,
} from "./prompt-helpers";
import { buildInterviewState } from "./state-builder";
import { getBodyDiagramPromptSection } from "@/lib/body-diagram-images";

type LabTopic = { label: string; mustAsk: string[] };

// Checks if a lab test name appears near an "A" (abnormal) flag in raw lab data,
// or near common abnormal keywords in AI-generated summaries.
function isAbnormal(labText: string, testPattern: RegExp): boolean {
  const lines = labText.split(/\n/);
  for (const line of lines) {
    if (testPattern.test(line)) {
      // Raw lab format: value followed by "A" flag (e.g. "7.29	A	0.32-5.04")
      if (/\t\s*A\s*\t/.test(line) || /\s+A\s+\d/.test(line)) return true;
      // AI-generated summary keywords
      if (/\b(abnormal|flagged|elevated|high|above|low|below|deficien|outside)\b/i.test(line)) return true;
    }
  }
  // Also check freeform patterns across the whole text
  return false;
}

function detectLabAbnormalities(labText: string): LabTopic[] {
  const topics: LabTopic[] = [];

  // Iron deficiency / low ferritin
  const hasLowFerritin =
    /\b(low ferritin|ferritin.*low|ferritin.*deficien|iron deficien)\b/i.test(labText) ||
    isAbnormal(labText, /\bferritin\b/i);
  if (hasLowFerritin) {
    topics.push({
      label: "Iron deficiency / low ferritin",
      mustAsk: [
        "Iron supplement intake: name, dose, and how consistently taken.",
        "Dietary iron intake: red meat, poultry, fish, legumes, spinach, fortified cereals — how often.",
        "Factors that may impair absorption: tea/coffee with meals, GI symptoms, heavy periods.",
      ],
    });
  }

  // Elevated TSH / hypothyroidism
  const hasHighTSH =
    /\b(elevated tsh|high tsh|tsh.*elevated|tsh.*high)\b/i.test(labText) ||
    isAbnormal(labText, /\bTSH\b/i);
  if (hasHighTSH) {
    topics.push({
      label: "Elevated TSH (hypothyroidism not optimally controlled)",
      mustAsk: [
        "Thyroid medication adherence: taking levothyroxine (or equivalent) consistently, any missed doses.",
        "Hypothyroid symptoms: fatigue, weight gain, cold intolerance, constipation, dry skin, hair thinning, cognitive slowness.",
        "Any recent changes in dose or medication brand.",
      ],
    });
  }

  // Elevated HbA1c / prediabetes / diabetes
  const hasHighA1c =
    /\b(elevated a1c|high a1c|a1c.*elevated|hba1c.*elevated|hemoglobin a1c.*abnormal)\b/i.test(labText) ||
    isAbnormal(labText, /\b(hemoglobin a1c|hba1c|a1c)\b/i);
  if (hasHighA1c) {
    topics.push({
      label: "Elevated HbA1c (prediabetes or diabetes range)",
      mustAsk: [
        "Any symptoms of high blood sugar: increased thirst, frequent urination, fatigue, blurred vision.",
        "Dietary habits and physical activity level.",
        "Any prior discussion of prediabetes or diabetes management with their doctor.",
      ],
    });
  }

  // Elevated cholesterol / LDL
  const hasHighLipids =
    /\b(elevated ldl|high ldl|high cholesterol|elevated cholesterol|ldl.*elevated|cholesterol.*elevated)\b/i.test(labText) ||
    isAbnormal(labText, /\b(ldl cholesterol|ldl)\b/i) ||
    isAbnormal(labText, /\bcholesterol\b/i);
  if (hasHighLipids) {
    topics.push({
      label: "Elevated cholesterol / LDL",
      mustAsk: [
        "Current statin or lipid-lowering medication: name, dose, adherence.",
        "Any statin side effects: muscle aches, weakness, or tenderness.",
        "Diet and lifestyle: saturated fat intake, physical activity.",
      ],
    });
  }

  return topics;
}

function buildLabMandatoryTopicsSection(labText: string): string {
  const topics = detectLabAbnormalities(labText);
  if (topics.length === 0) return "";

  const lines = topics.map((topic, i) => {
    const asks = topic.mustAsk.map((a) => `   - ${a}`).join("\n");
    return `${i + 1}. ${topic.label}\n${asks}`;
  });

  return `\nABNORMAL LAB FINDINGS — MANDATORY INTERVIEW TOPICS (${topics.length} conditions):
You MUST address ALL of the following conditions before providing a summary. Do not skip any:
${lines.join("\n")}

Use your clinical judgment to determine how many questions each finding warrants. When the patient's answer contains a clinically relevant detail — a stopped medication, a reported symptom, a lifestyle factor affecting the condition — follow up on that detail before moving to the next condition. Do not compress multiple distinct conditions into a single turn.`;
}

function formatTranscript(transcript: InterviewMessage[]) {
  return transcript
    .map((message) => `${message.role === "assistant" ? "Assistant" : "Patient"}: ${message.content}`)
    .join("\n");
}

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","could","should","may","might","can","your","you","my",
  "me","i","we","us","it","its","this","that","these","those","how","what",
  "when","where","why","which","who","if","any","all","no","not","so","as",
  "from","about","than","then","there","their","they","them","he","she","his",
  "her","our","also","please","describe","explain",
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function extractUncoveredFormQuestions(
  formSummary: string,
  questionsAsked: string[],
  patientAnswers: string[],
): string[] {
  const questionLines = formSummary
    .split("\n")
    .map((line) => line.match(/^\s*\d+[\.\)]\s+(.+)/)?.[1]?.trim())
    .filter((q): q is string => Boolean(q));

  if (questionLines.length === 0) return [];

  const coveredText = [...questionsAsked, ...patientAnswers].join(" ").toLowerCase();

  return questionLines.filter((question) => {
    const keywords = extractKeywords(question);
    if (keywords.length === 0) return false;
    const matchCount = keywords.filter((kw) => coveredText.includes(kw)).length;
    // Consider covered if at least 2 keywords appear in what's been asked/answered
    return matchCount < 2;
  });
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

  const recentTranscript = transcript.length > 30 ? transcript.slice(-30) : transcript;
  const recentQuestions = interviewState.allQuestionsAsked.slice(-16);
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
    : `PHOTO CONTEXT:\nNo photo has been provided yet. Use your clinical judgment — if seeing the affected area would meaningfully help the physician assess this complaint, you may ask the patient to upload a photo. Set "requiresPhotoUpload": true when doing so. Never ask for a photo if the affected area involves genitals, the anal region, or breasts — describe those in words only.`;
  const combinedLabText = [labReportSummary, previousLabReportSummary].filter(Boolean).join(" ");
  const labMandatoryTopics = combinedLabText ? buildLabMandatoryTopicsSection(combinedLabText) : "";
  const labSection =
    labReportSummary || previousLabReportSummary
      ? `LAB CONTEXT:
${labReportSummary ? `Current summary: ${labReportSummary}` : ""}
${previousLabReportSummary ? `Previous summary: ${previousLabReportSummary}` : ""}
- Use only these provided lab/imaging summaries. Do not invent missing results.${labMandatoryTopics}`
      : "LAB CONTEXT:\nNo physician-provided lab summary.";
  const formSection = formSummary
    ? `FORM CONTEXT:\n${formSummary}\n- REQUIRED: You MUST ask every question listed above before providing a summary. Do not assume any question is already answered by the chief complaint alone — open-ended questions like "describe your disability" or "how does this affect your life" must be asked explicitly during the interview, even if the patient's opening statement seems to address them.`
    : "";

  const uncoveredFormQuestions = formSummary
    ? extractUncoveredFormQuestions(formSummary, interviewState.allQuestionsAsked, interviewState.patientAnswers)
    : [];
  const formReminderSection = uncoveredFormQuestions.length > 0
    ? `FORM QUESTIONS NOT YET ASKED (you must ask these before summarizing):\n${uncoveredFormQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
    : "";
  const guidanceSection = interviewGuidance
    ? `PHYSICIAN GUIDANCE:\n${interviewGuidance}\n- This guidance is authoritative. Follow it to direct the focus and scope of the interview.`
    : "";
  const medPmhSection = medPmhSummary
    ? `UPLOADED MEDS/PMH CONTEXT:\n${medPmhSummary}`
    : "";
  const patientBackgroundSection = patientBackground
    ? `PHYSICIAN-PROVIDED BACKGROUND:\n${patientBackground}\n- This background is authoritative. Use it to focus the interview. Do NOT ask the patient to re-report information already stated here (e.g., known diagnoses, prior lab values, reason for visit, referral context). Build on it rather than re-establishing it.`
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
  const bodyDiagramDirective = interviewState.completedDiagramParts.length > 0
    ? `\nBODY DIAGRAM STATUS: The patient has ALREADY marked the following diagrams: ${interviewState.completedDiagramParts.join(", ")}. Do NOT ask them to mark these diagrams again. Set "requiresLocationMarking": false for any question about these body parts. You may still use diagrams for OTHER body parts not in this list.`
    : "";

  const mvaAdminSection = getMvaAdminPromptSection(chiefComplaint);

  const isOpeningTurn = !chiefComplaint && transcript.length === 0;
  const taskInstruction = forceSummary
    ? "Provide a physician-handoff summary based on the established history. Do not ask another question."
    : isOpeningTurn
      ? "Greet the patient warmly and ask what brings them in today. Keep it brief and friendly."
      : "Either (a) ask the next most appropriate question to continue gathering history, or (b) provide a physician-handoff summary if the history is sufficient for handoff.";

  const fullPrompt = `
You are a Physician Assistant conducting a medical history. You decide what to ask next and when the history is sufficient to summarize. Do not provide treatment recommendations, medication instructions, dosing advice, or diagnosis to the patient.

RULES:
- Be natural and concise. You may group related questions together to ask fewer questions. This reduces patient fatigue.
- Conduct patient-facing text in ${languageName}. Keep clinician summary fields in English.
- Stay on the active complaint unless the patient redirects.
- Listen carefully to patient corrections and redirections.
- Ask concise, natural follow-up questions based on the patient’s last response.
- As much as possible, make it feel like a physician-assistant–patient conversation.
- If the patient mentions a significant secondary concern such as worsening mood, depression, anxiety, chest pain, shortness of breath, weakness, or another potentially important symptom, explore it with focused follow-up questions before returning to the main complaint.
- If the patient states they were called in (by their doctor or doctor's office) to discuss, review, or go over their lab or blood work results, do NOT ask what the results showed — the patient has not been told yet; that is the purpose of the appointment. Instead, ask about any symptoms they are experiencing related to the concern, or whether they have additional questions or issues to discuss at this visit.

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
${formReminderSection}
${guidanceSection}
${sensitivePhotoDirective}

${bodyDiagramSection}${bodyDiagramDirective}
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
- If asking a question: {"type":"question","question":"...","rationale":"...","requiresPhotoUpload":false,"requiresLocationMarking":false,"progress":{"questionsAsked":N,"approxTotalQuestions":M}}${languageName !== "English" ? `
  IMPORTANT — physician monitor fields (never shown to patient, ALWAYS required when language is not English):
  "question_en": "Exact English translation of the question field"
  "patient_message_en": "Exact English translation of the patient's most recent message in the transcript (omit only if there is no patient message at all)"
  Full example for non-English: {"type":"question","question":"[in ${languageName}]","question_en":"[exact English translation]","patient_message_en":"[patient last message in English]","rationale":"...","requiresPhotoUpload":false,"requiresLocationMarking":false,"progress":{"questionsAsked":N,"approxTotalQuestions":M}}` : ""}
  - Ask one or more related questions when grouping flows naturally. NEVER ask more than 2 questions in a single turn.
  - When asking multiple questions in a single turn, number each question (1., 2., etc.) and place each on its own line for clarity. Maximum 2 questions per turns. For example: "1. How severe is the pain on a scale of 0-10?\n2. Does it stay in one place or spread elsewhere?"
  - Keep the rationale brief and clinical.
  - Set "requiresPhotoUpload": true only when the question explicitly asks for an image upload.
  - Set "requiresLocationMarking": true when the question asks the patient to mark the location on a body diagram AND you can supply a non-empty "locationBodyParts" array. If you cannot identify a specific diagram to show, do NOT use "requiresLocationMarking": true and do NOT reference the diagram in the question text.
  - Optionally include "newComplaints" (string array) when the patient's last message introduces a clearly NEW, affirmatively stated complaint not already listed in active or pending complaints. Only include complaints the patient affirms they currently have. Do NOT include: denied symptoms ("no chest pain"), symptoms reported about others, resolved conditions, or vague references. Omit "newComplaints" entirely if nothing new was introduced.
- If providing a summary: {"type":"summary","positives":["..."],"negatives":["..."],"summary":"...","investigations":["..."],"assessment":"...","plan":["..."],"isEmergency":true|false,"progress":{"questionsAsked":N,"approxTotalQuestions":N}}
  - You MUST include "isEmergency": true or false in every summary. Apply the emergency evaluation rules from your system instructions.
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
