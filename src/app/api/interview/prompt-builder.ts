import { logDebug } from "@/lib/secure-logger";
import type { InterviewMessage, PatientProfile } from "@/lib/interview-schema";
import {
  computeFormInterviewPhase,
  getFormCoverageHints,
  getMvaFollowUpPromptSection,
  type SensitivePhotoContext,
} from "./prompt-helpers";
import { hasLocationAnswerSignal, hasLocationQuestionIntent } from "./location-signals";
import { getMskDiagramProgress } from "./msk-second-question";
import type { ComplaintClass } from "./protocol-types";
import { buildInterviewState } from "./state-builder";

const BASE_QUESTION_BUDGET = 15;
const FATIGUE_PHRASES = [
  "i already answered",
  "already answered that",
  "too many questions",
  "stop asking",
  "you asked that",
  "enough questions",
];

function getScopedRedFlags(complaintClass: ComplaintClass): string[] {
  switch (complaintClass) {
    case "Cardio":
      return [
        "Exertional chest pain or pressure",
        "Radiation to arm/jaw/back",
        "Associated dyspnea, diaphoresis, or syncope",
        "Known cardiac risk factors",
      ];
    case "Neuro":
      return [
        "Worst headache of life / thunderclap onset",
        "Focal neurologic deficit (weakness, numbness, speech or vision changes)",
        "Fever/meningismus with headache",
        "Head trauma, immunosuppression, or known malignancy",
      ];
    case "GI":
      return [
        "Severe or worsening abdominal pain",
        "GI bleeding (melena, hematemesis, or hematochezia)",
        "Persistent vomiting/dehydration",
        "Peritoneal signs or systemic toxicity",
      ];
    case "Respiratory":
      return [
        "Severe dyspnea at rest",
        "Hypoxia/cyanosis signs",
        "Pleuritic chest pain or hemoptysis",
        "Inability to speak full sentences",
      ];
    case "MSK":
      return [
        "Inability to weight bear or severe functional loss",
        "Open injury or gross deformity",
        "Neurovascular compromise",
        "Rapid progressive swelling or compartment-like pain",
      ];
    case "Trauma":
      return [
        "Loss of consciousness or amnesia",
        "High-impact mechanism / major vehicle damage",
        "Neurologic deficits or spine symptoms",
        "Chest/abdominal injury or uncontrolled bleeding",
      ];
    case "Dermatology":
      return [
        "Rapidly progressive rash with systemic symptoms",
        "Mucosal involvement",
        "Signs of severe infection/necrosis",
        "Immunocompromised host",
      ];
    default:
      return [
        "Severe uncontrolled pain",
        "Acute mental status change",
        "Persistent high fever with systemic symptoms",
      ];
  }
}

function detectFatigueSignals(patientAnswers: string[]): { active: boolean; signals: string[] } {
  const lowerAnswers = patientAnswers.map((a) => a.toLowerCase().trim()).filter(Boolean);
  const signals: string[] = [];

  if (lowerAnswers.some((a) => FATIGUE_PHRASES.some((p) => a.includes(p)))) {
    signals.push("explicit-fatigue-statement");
  }

  const oneWordCount = lowerAnswers.filter((a) => a.split(/\s+/).length <= 1).length;
  if (lowerAnswers.length >= 3 && oneWordCount >= Math.ceil(lowerAnswers.length * 0.6)) {
    signals.push("predominantly-one-word-responses");
  }

  return { active: signals.length > 0, signals };
}

function extractTopics(question: string): string[] {
  const qLower = question.toLowerCase();
  const topics: string[] = [];

  if (qLower.match(/\b(severity|severe|pain level|scale|0-10|how bad|intensity)\b/)) topics.push("severity");
  if (hasLocationQuestionIntent(qLower)) topics.push("location");
  if (qLower.match(/\b(duration|how long|when did it start|onset|started|began)\b/))
    topics.push("duration/onset");
  if (qLower.match(/\b(quality|what does it feel like|describe|type of pain|character)\b/))
    topics.push("quality");
  if (qLower.match(/\b(triggers|what makes it worse|worsens|aggravates|provokes)\b/))
    topics.push("triggers");
  if (qLower.match(/\b(relieving|what makes it better|improves|helps|relief)\b/))
    topics.push("relieving factors");
  if (qLower.match(/\b(associated|other symptoms|also|in addition|accompanied)\b/))
    topics.push("associated symptoms");
  if (qLower.match(/\b(nasal|congestion|runny nose|post[- ]?nasal drip|sneez(ing)?|sinus)\b/))
    topics.push("upper respiratory symptoms");
  if (qLower.match(/\b(voice|hoarse|hoarseness|dysphonia|difficulty speaking|difficulty swallowing|dysphagia)\b/))
    topics.push("voice/swallowing");
  if (qLower.match(/\b(cough|coughing fits|whooping|barking)\b/)) topics.push("cough characteristics");
  if (qLower.match(/\b(shortness of breath|dyspnea|breathless|difficulty breathing|wheez(e|ing)|chest tightness)\b/))
    topics.push("respiratory");
  if (qLower.match(/\b(fever|chills|night sweats|sweats|fatigue|weight loss|appetite)\b/))
    topics.push("constitutional symptoms");
  if (qLower.match(/\b(travel|recent travel|flight|flew|airport|exposure|sick contact|close contact|covid)\b/))
    topics.push("travel/exposures");
  if (qLower.match(/\b(irritant|smoke|allergen|chemical|pollution|cold air|dry air|environment)\b/))
    topics.push("environmental exposures");
  if (qLower.match(/\b(lymph node|lump|swollen gland|swelling in neck)\b/)) topics.push("lymph nodes");
  if (qLower.match(/\b(sleep|at night|lying down|when you lie|bedtime)\b/)) topics.push("sleep/positional");
  if (qLower.match(/\b(range of motion|rom|move|bend|straighten|flex|extend)\b/))
    topics.push("range of motion");
  if (qLower.match(/\b(tenderness|tender|palpation|press|touch)\b/)) topics.push("tenderness");
  if (qLower.match(/\b(swelling|swollen|edema)\b/)) topics.push("swelling");
  if (qLower.match(/\b(redness|red|inflammation)\b/)) topics.push("redness");
  if (qLower.match(/\b(exudate|discharge|pus|white spots|drainage)\b/)) topics.push("exudate");
  if (qLower.match(/\b(blood pressure|bp|hypertension|elevated)\b/)) topics.push("blood pressure");
  if (qLower.match(/\b(chest pain|cardiac|heart)\b/)) topics.push("cardiac symptoms");
  if (qLower.match(/\b(shortness of breath|dyspnea|breathing|respiratory)\b/)) topics.push("respiratory");
  if (qLower.match(/\b(neurological|weakness|numbness|tingling|paralysis)\b/)) topics.push("neurological");
  if (qLower.match(/\b(loss of consciousness|passed out|fainted|unconscious)\b/))
    topics.push("loss of consciousness");
  if (qLower.match(/\b(accident|mva|motor vehicle|car accident|collision)\b/))
    topics.push("accident details");
  if (qLower.match(/\b(seatbelt|airbag|ambulance|er|emergency room)\b/))
    topics.push("accident response");
  if (qLower.match(/\b(previous injury|prior injury|before|had you ever)\b/))
    topics.push("previous injuries");

  return topics;
}

function extractInformationFromAnswers(answers: string[]) {
  if (answers.length === 0) {
    return {
      mentionedTopics: [] as string[],
      symptomDetails: [] as string[],
      redFlagsMentioned: [] as string[],
      informationSummary: "",
    };
  }

  const allAnswersText = answers.join(" ").toLowerCase();
  const mentionedTopics: string[] = [];
  const symptomDetails: string[] = [];
  const redFlagsMentioned: string[] = [];

  if (allAnswersText.match(/\b(severity|severe|pain level|scale|0-10|how bad|intensity|mild|moderate|severe)\b/)) {
    mentionedTopics.push("severity");
    const severityMatch = allAnswersText.match(/\b(\d+\/10|\d+ out of 10|mild|moderate|severe|very severe)\b/i);
    if (severityMatch) symptomDetails.push(`Severity: ${severityMatch[0]}`);
  }
  if (hasLocationAnswerSignal(allAnswersText)) mentionedTopics.push("location");
  if (allAnswersText.match(/\b(duration|how long|when did it start|onset|started|began|days|weeks|months|hours)\b/)) {
    mentionedTopics.push("duration/onset");
    const durationMatch = allAnswersText.match(/\b(\d+\s*(day|week|month|hour|minute)s?)\b/i);
    if (durationMatch) symptomDetails.push(`Duration: ${durationMatch[0]}`);
  }
  if (allAnswersText.match(/\b(quality|what does it feel like|describe|type of pain|character|sharp|dull|aching|burning|throbbing)\b/)) {
    mentionedTopics.push("quality");
  }
  if (allAnswersText.match(/\b(triggers|what makes it worse|worsens|aggravates|provokes|when|during|after)\b/)) {
    mentionedTopics.push("triggers");
  }
  if (allAnswersText.match(/\b(relieving|what makes it better|improves|helps|relief|medication|rest|ice|heat)\b/)) {
    mentionedTopics.push("relieving factors");
  }
  if (allAnswersText.match(/\b(associated|other symptoms|also|in addition|accompanied|nausea|fever|chills|dizziness)\b/)) {
    mentionedTopics.push("associated symptoms");
  }
  if (allAnswersText.match(/\b(range of motion|rom|move|bend|straighten|flex|extend|can't move|limited)\b/)) {
    mentionedTopics.push("range of motion");
  }
  if (allAnswersText.match(/\b(tenderness|tender|palpation|press|touch|hurts when|painful when)\b/)) {
    mentionedTopics.push("tenderness");
  }
  if (allAnswersText.match(/\b(swelling|swollen|edema|puffy|enlarged)\b/)) mentionedTopics.push("swelling");
  if (allAnswersText.match(/\b(redness|red|inflammation|inflamed)\b/)) mentionedTopics.push("redness");
  if (allAnswersText.match(/\b(exudate|discharge|pus|white spots|drainage|draining)\b/)) mentionedTopics.push("exudate");
  if (allAnswersText.match(/\b(blood pressure|bp|hypertension|elevated|high blood pressure)\b/)) {
    redFlagsMentioned.push("blood pressure");
  }
  if (allAnswersText.match(/\b(chest pain|cardiac|heart|heart attack|angina)\b/)) {
    redFlagsMentioned.push("cardiac symptoms");
  }
  if (allAnswersText.match(/\b(shortness of breath|dyspnea|breathing|respiratory|can't breathe|difficulty breathing)\b/)) {
    redFlagsMentioned.push("respiratory");
  }
  if (allAnswersText.match(/\b(neurological|weakness|numbness|tingling|paralysis|can't move|loss of sensation)\b/)) {
    redFlagsMentioned.push("neurological");
  }
  if (allAnswersText.match(/\b(loss of consciousness|passed out|fainted|unconscious|blacked out)\b/)) {
    redFlagsMentioned.push("loss of consciousness");
  }
  if (allAnswersText.match(/\b(accident|mva|motor vehicle|car accident|collision|crash)\b/)) {
    mentionedTopics.push("accident details");
  }
  if (allAnswersText.match(/\b(seatbelt|airbag|ambulance|er|emergency room|hospital)\b/)) {
    mentionedTopics.push("accident response");
  }
  if (allAnswersText.match(/\b(previous injury|prior injury|before|had you ever|in the past)\b/)) {
    mentionedTopics.push("previous injuries");
  }

  const informationSummary = [
    ...(mentionedTopics.length > 0 ? [`Topics mentioned: ${[...new Set(mentionedTopics)].join(", ")}`] : []),
    ...symptomDetails,
    ...(redFlagsMentioned.length > 0 ? [`Red flags addressed: ${redFlagsMentioned.join(", ")}`] : []),
  ].join("\n");

  return {
    mentionedTopics: [...new Set(mentionedTopics)],
    symptomDetails,
    redFlagsMentioned: [...new Set(redFlagsMentioned)],
    informationSummary,
  };
}

function formatTranscript(transcript: InterviewMessage[]) {
  return (
    "Transcript:\n" +
    transcript
      .map((message) => `${message.role === "assistant" ? "Assistant" : "Patient"}: ${message.content}`)
      .join("\n")
  );
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
): string {
  const allQuestionsAsked = transcript
    .filter((msg) => msg.role === "assistant")
    .map((msg) => msg.content.trim())
    .filter((content) => content.length > 0);
  const patientAnswers = transcript
    .filter((msg) => msg.role === "patient")
    .map((msg) => msg.content.trim())
    .filter((content) => content.length > 0);

  const topicsCovered = new Set<string>();
  allQuestionsAsked.forEach((q) => extractTopics(q).forEach((topic) => topicsCovered.add(topic)));
  const patientInformation = extractInformationFromAnswers(patientAnswers);
  const interviewState = buildInterviewState({
    chiefComplaint,
    patientProfile: profile,
    transcript,
    formSummary,
    patientBackground,
    forceSummary,
    deferredIntentHint,
  });

  const maxTranscriptLength = 20;
  const transcriptToUse = transcript.length > maxTranscriptLength ? transcript.slice(-maxTranscriptLength) : transcript;
  const transcriptSection = transcriptToUse.length ? formatTranscript(transcriptToUse) : "Transcript: (no questions have been asked yet)";
  const imageSection = imageSummary
    ? `Image-based findings (from patient-provided photo): ${imageSummary}\n\nNOTE: A photo has already been uploaded and analyzed. You MUST briefly acknowledge that you reviewed the uploaded photo. Ask image-focused clarifying questions only if needed to resolve uncertainty in clinical history or visual findings. Do NOT ask for another photo unless image quality is insufficient to proceed.`
    : "Image-based findings: (no photo provided or not yet analyzed)";
  const medPmhSection = medPmhSummary
    ? `\n\nMedication list / PMH (from uploaded photo):\n${medPmhSummary}\n\nCRITICAL: Treat these as patient-reported meds and history. Confirm key items briefly; do NOT re-ask unless clarifying discrepancies.`
    : "";

  let labReportSection = "";
  if (labReportSummary && previousLabReportSummary) {
    labReportSection = `\n\nCurrent Lab Report Summary (from physician-uploaded PDF):\n${labReportSummary}\n\nPrevious Lab Report Summary (from physician-uploaded PDF):\n${previousLabReportSummary}\n\nCRITICAL: Compare the two lab reports and identify:
1. Values that have changed (improved or worsened)
2. Trends (e.g., cholesterol increasing/decreasing over time)
3. New abnormalities that appeared in the current report
4. Abnormalities that resolved between the two reports

Discuss these changes with the patient, ask about interventions or lifestyle changes between the two dates, and provide context about what the changes mean clinically. Proactively discuss abnormal findings and trends. Ask about relevant history, family history, and lifestyle factors (diet, exercise, smoking, alcohol) when appropriate. Do NOT provide treatment or medication recommendations; defer treatment decisions to the physician.

If the patient asks about a lab value or test result NOT mentioned in these summaries, you MUST respond: "I don't have that specific result in the lab report summaries provided. Your physician will be able to discuss that with you in detail during your visit." Do NOT make up or guess about results not in the summaries.`;
  } else if (labReportSummary) {
    labReportSection = `\n\nLab Report Summary (from physician-uploaded PDF):\n${labReportSummary}\n\nCRITICAL: Use this lab report information to guide your questions. Proactively discuss abnormal findings with the patient. Ask about relevant history, family history, and lifestyle factors (diet, exercise, smoking, alcohol) when appropriate. Do NOT provide treatment or medication recommendations; defer treatment decisions to the physician. If the patient asks about a lab value or test result NOT mentioned in this summary, you MUST respond: "I don't have that specific result in the lab report summary provided. Your physician will be able to discuss that with you in detail during your visit." Do NOT make up or guess about results not in the summary.`;
  } else if (previousLabReportSummary) {
    labReportSection = `\n\nPrevious Lab Report Summary (from physician-uploaded PDF):\n${previousLabReportSummary}\n\nCRITICAL: Use this previous lab report information to guide your questions. Proactively discuss abnormal findings with the patient. Ask about relevant history, family history, and lifestyle factors (diet, exercise, smoking, alcohol) when appropriate. Do NOT provide treatment or medication recommendations; defer treatment decisions to the physician. If the patient asks about a lab value or test result NOT mentioned in this summary, you MUST respond: "I don't have that specific result in the lab report summary provided. Your physician will be able to discuss that with you in detail during your visit." Do NOT make up or guess about results not in the summary.`;
  }

  logDebug("[buildPrompt] labReportSummary metadata", { present: !!labReportSummary, length: labReportSummary?.length ?? 0 });
  logDebug("[buildPrompt] previousLabReportSummary metadata", { present: !!previousLabReportSummary, length: previousLabReportSummary?.length ?? 0 });
  logDebug("[buildPrompt] labReportSection length", { length: labReportSection.length });

  const formSection = formSummary
    ? `\n\nForm to Complete (from physician-uploaded PDF):\n${formSummary}\n\nCRITICAL: This form needs to be completed for the patient.
1. Understand the form's purpose and context (e.g., school form, work form, MVA insurance form)
2. Collect enough information for the physician to mostly complete the form
3. Keep interview style natural (not a robotic checklist)
4. Maintain clinical safety priorities at all times
5. In your final summary, include concise form-relevant responses the physician can reuse`
    : "";
  logDebug("[buildPrompt] formSummary metadata", { present: !!formSummary, length: formSummary?.length ?? 0 });
  logDebug("[buildPrompt] formSection length", { length: formSection.length });

  const physicianGuidanceSection = interviewGuidance
    ? `\n\n*** PHYSICIAN-SPECIFIC INTERVIEW GUIDANCE (MANDATORY - MUST FOLLOW) ***\n${interviewGuidance}\n\nCRITICAL: The above guidance contains MANDATORY instructions from this physician. You MUST follow these instructions during the interview. These instructions take precedence over general guidelines. For example, if the guidance says "Always ask about X", you MUST ask about X during the interview. Integrate these instructions naturally into your clinical questioning.`
    : "";
  logDebug("[buildPrompt] interviewGuidance metadata", { present: !!interviewGuidance, length: interviewGuidance?.length ?? 0 });

  const transcriptNote = transcript.length > maxTranscriptLength
    ? `\nNote: Transcript has been truncated to the most recent ${maxTranscriptLength} messages for context. Total questions asked: ${transcript.length}.`
    : "";
  const maxQuestionsToShow = 50;
  const questionsToShow = allQuestionsAsked.length > maxQuestionsToShow ? allQuestionsAsked.slice(-maxQuestionsToShow) : allQuestionsAsked;
  const questionsList = allQuestionsAsked.length > 0
    ? `\n\nQUESTIONS ALREADY ASKED (DO NOT REPEAT THESE - TOTAL: ${allQuestionsAsked.length}):\n${allQuestionsAsked.length > maxQuestionsToShow ? `[Showing last ${maxQuestionsToShow} of ${allQuestionsAsked.length} questions]\n` : ""}${questionsToShow.map((q, i) => `${allQuestionsAsked.length > maxQuestionsToShow ? allQuestionsAsked.length - maxQuestionsToShow + i + 1 : i + 1}. ${q}`).join("\n")}\n\nCRITICAL ANTI-DUPLICATE RULES:\n- Do NOT ask any of these ${allQuestionsAsked.length} questions again, even if rephrased\n- Do NOT ask semantically similar questions (e.g., "What is the severity?" vs "On a scale of 0-10, how severe is it?")\n- Before asking your next question, compare it against ALL ${allQuestionsAsked.length} questions above\n- If your question asks about the same topic as any previous question, choose a DIFFERENT topic\n- Move to a different clinical topic that hasn't been covered yet`
    : "\n\nNo questions have been asked yet. This is your FIRST question. CRITICAL: You MUST rephrase the chief complaint into a natural sentence - DO NOT copy it verbatim from the chief complaint box. For example, if the chief complaint is '3 days of sore throat', rephrase it as 'I understand you've been experiencing a sore throat for the past three days' or 'Tell me about the sore throat that started three days ago' - do NOT just say '3 days of sore throat'.";
  const topicsList = topicsCovered.size > 0
    ? `\n\nTOPICS ALREADY COVERED (DO NOT ASK ABOUT THESE AGAIN):\n${Array.from(topicsCovered).sort().map((topic) => `  - ${topic}`).join("\n")}\n\nCRITICAL: Before asking your next question, verify it is NOT asking about any of these topics. If your question relates to any topic above, choose a DIFFERENT topic that hasn't been covered.`
    : "";
  const informationAlreadyProvided = patientAnswers.length > 0 && patientInformation.informationSummary
    ? `\n\nINFORMATION ALREADY PROVIDED BY PATIENT:\n${patientInformation.informationSummary}\n\nCRITICAL: The patient has already mentioned the above information in their responses. Do NOT ask questions about these topics again. Review what the patient has said before asking your next question. If the patient mentioned severity, location, duration, triggers, relieving factors, associated symptoms, or any other clinical information, do NOT ask about it again.`
    : "";

  const isEarlyConversation = allQuestionsAsked.length < 4;
  const isFirstQuestion = allQuestionsAsked.length === 0;
  const openEndedReminder = isEarlyConversation
    ? `\n\nCRITICAL: ${isFirstQuestion ? "This is your FIRST question as a Physician Assistant. " : "You are early in the clinical interview. "}${isFirstQuestion ? "You MUST rephrase the chief complaint into a natural clinical sentence - DO NOT copy it verbatim. " : ""}Use an OPEN-ENDED question that invites the patient to tell their story (e.g., 'Tell me about your [symptom]' or 'Can you describe what's been happening?'). After gathering the narrative, transition to focused clinical questions that help with differential diagnosis and red flag assessment.`
    : "";
  const mvaFollowUpSection = getMvaFollowUpPromptSection({ chiefComplaint, patientBackground, formSummary, patientAnswers });

  const complaints = interviewState.complaints;
  const hasMultipleComplaints = complaints.length > 1;
  const complaintsList = hasMultipleComplaints
    ? `\n\nCHIEF COMPLAINTS (${complaints.length} total):\n${complaints.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nCRITICAL: You must address ALL complaints sequentially. Complete all questions for complaint #1 before moving to complaint #2, and so on. Do NOT summarize until ALL complaints are fully explored.`
    : "";
  const currentComplaintIndex = interviewState.activeComplaintIndex;
  const currentComplaint = interviewState.activeComplaint;
  const remainingComplaints = interviewState.pendingComplaints;
  const completedComplaintsList = interviewState.completedComplaints;
  const lastPatientMessageIndex = (() => {
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      if (transcript[index]?.role === "patient") return index;
    }
    return -1;
  })();
  const newlyQueuedComplaints = interviewState.complaintQueue.filter(
    (item) => item.addedMidInterview && item.firstDetectedAtMessageIndex === lastPatientMessageIndex,
  );
  const dynamicComplaintSection = interviewState.newComplaintCount > 0
    ? `\n\nDYNAMIC COMPLAINT QUEUE:\n- ${interviewState.newComplaintCount} complaint${interviewState.newComplaintCount === 1 ? "" : "s"} were added mid-interview.\n- These complaints must stay queued as pending until the current complaint is complete unless urgent escalation is required.\n- Budget modifier applied: +8 questions per newly added complaint.`
    : "";
  const newlyQueuedConcernSection = newlyQueuedComplaints.length > 0
    ? `\n\nNEW CONCERN ACKNOWLEDGMENT (MANDATORY THIS TURN):\n- The patient just introduced ${newlyQueuedComplaints.length === 1 ? "a new concern" : "new concerns"}: ${newlyQueuedComplaints.map((item) => `"${item.complaint}"`).join(", ")}.\n- Start your next patient-facing message with one brief acknowledgment that you noted ${newlyQueuedComplaints.length === 1 ? "this concern" : "these concerns"}.\n- If "${currentComplaint}" is still the active complaint, briefly acknowledge the newly added concern${newlyQueuedComplaints.length === 1 ? "" : "s"} and say you will return to ${newlyQueuedComplaints.length === 1 ? "it" : "them"} after finishing the current complaint, then ask one focused question only about "${currentComplaint}".\n- If the active complaint has already advanced to one of the newly queued concerns, briefly acknowledge the transition and continue with the next appropriate question for that concern.\n- This brief acknowledgment is allowed even though other complaints normally remain off-limits until the current complaint is complete. Do NOT ask substantive clinical questions about queued concerns until it is their turn unless urgent escalation is required.`
    : "";
  const languageSection = languageName
    ? `\n\nLANGUAGE PREFERENCE: Conduct all patient-facing questions and messages in ${languageName}. If you cannot reliably produce ${languageName}, fall back to English. Do NOT mix languages.`
    : "";
  const sensitivePhotoDirective = sensitivePhotoContext.suppressPhotoRequest
    ? `\n\nSENSITIVE PHOTO SAFETY OVERRIDE (MANDATORY):\n- Sensitive area context detected (${sensitivePhotoContext.reason}).\n- You MUST NOT ask the patient to upload/share/send/take any photo for this complaint.\n- Set "requiresPhotoUpload": false.\n- Continue with text-only history questions and respectful, non-image clarifying questions.`
    : "";

  const mskProgress = getMskDiagramProgress(chiefComplaint, transcript);
  const shouldForceMskLocationNext =
    mskProgress.isMskComplaint && !forceSummary && new Set([1, 4, 9]).has(allQuestionsAsked.length) && mskProgress.remainingParts.length > 0;
  const mskMissingPartList = mskProgress.remainingPartNames.join(", ");
  const mskLocationDirective = shouldForceMskLocationNext
    ? `\n\nCRITICAL MSK LOCATION CHECKPOINT (DIAGRAM REQUIRED):\n- This is a musculoskeletal complaint and these body parts still need location marking: ${mskMissingPartList}.\n- The NEXT question MUST ask the patient to mark the painful location on the body diagram/photo for EACH remaining part.\n- Use phrasing like: \"Looking at the diagram/photo of your ${mskMissingPartList}, please mark exactly where the pain is.\"\n- Do NOT ask for numbered areas. Ask the patient to click/tap/mark the exact painful spot.\n- Keep re-checking missing parts at question checkpoints 2, 5, and 10 until all required parts are marked.\n`
    : "";
  const deferredIntentSection = deferredIntentHint
    ? `\n\nDEFERRED CLINICAL INTENT (PRIORITIZE NOW):\n- In the previous turn, the system intentionally used a location-marking question.\n- Your NEXT question should now cover this deferred clinical intent: ${deferredIntentHint}\n- Ask one concise, non-duplicative question that addresses the same intent.\n- Do NOT repeat the location-marking request unless the patient did not provide location information.\n`
    : "";

  const complaintClass = interviewState.complaintClass;
  const escalation = {
    active: interviewState.escalationReasons.length > 0,
    reasons: interviewState.escalationReasons,
    hasRedFlagSignal: interviewState.escalationReasons.includes("red-flag-identified"),
    hasMultiSystemSymptoms: interviewState.escalationReasons.includes("multi-system-symptoms") || interviewState.newComplaintCount > 0,
    hasChronicComplexity: interviewState.escalationReasons.includes("chronic-complexity"),
    isTraumaOrMva: interviewState.escalationReasons.includes("trauma-mva"),
    hasMedicoLegalDocumentation: false,
    hasStructuredFormUpload: Boolean(formSummary && formSummary.trim().length > 0),
  };
  const budget = { budget: interviewState.questionBudget, modifiers: interviewState.questionBudgetModifiers };
  const phaseState = computeFormInterviewPhase({
    hasStructuredForm: escalation.hasStructuredFormUpload,
    questionCountSoFar: allQuestionsAsked.length,
    budget,
    escalation,
    hasMultipleComplaints,
  });
  const formCoverageHints = getFormCoverageHints(formSummary);
  const remainingFormCoverageHints = interviewState.remainingFormCoverageHints;
  const fatigueSignals = detectFatigueSignals(patientAnswers);
  const redFlagChecklist = getScopedRedFlags(complaintClass);
  const shouldEarlyStop = interviewState.shouldEarlyStop;
  const redFlagSection = `\n\nRED FLAG ASSESSMENT CHECKLIST for "${currentComplaint}":\nBefore moving to the next complaint or summarizing, ensure you have assessed:\n${redFlagChecklist.map((flag, i) => `  ${i + 1}. ${flag}`).join("\n")}\n\nCRITICAL: If you have NOT asked about these red flags yet, you MUST ask about them before moving on.\nCRITICAL: Bundle related red flags into ONE question (enumerate them) instead of separate questions. Example: “Have you had any of the following: uncontrolled bleeding from mouth/nose; rash, joint pain, or swelling; changes in your voice or hoarseness; difficulty opening your mouth?”`;
  const controllerSection = `\n\nFOCUS CONTROLLER (ENFORCE STRICTLY):\n- Complaint class: ${complaintClass}\n- Scoped red flags only: ask ONLY from this complaint class; do NOT ask unrelated red-flag groups.\n- Questions asked so far: ${allQuestionsAsked.length}\n- Question budget: ${budget.budget === null ? "Unlimited (structured physician form uploaded)" : budget.budget}\n- Budget modifiers: ${budget.modifiers.join(", ")}\n- Escalation active: ${escalation.active ? "yes" : "no"}\n- Escalation reasons: ${escalation.reasons.length > 0 ? escalation.reasons.join(", ") : "none"}\n- Fatigue signals detected: ${fatigueSignals.active ? `yes (${fatigueSignals.signals.join(", ")})` : "no"}\n- Early-stop condition: ${shouldEarlyStop ? "MET — summarize now unless safety-critical data is missing." : "not met"}\n\nRules:\n1) Prioritize relevance over exhaustiveness.\n2) For straightforward complaints, limit to onset/location/duration/severity/key associated symptoms/relevant negatives/risk factors.\n3) Expand depth only when escalation is active.\n4) If early-stop condition is met, stop asking and summarize for physician handoff.`;
  const interviewPhaseSection = phaseState.hasStructuredForm
    ? `\n\nINTERVIEW PHASE CONTROLLER:\n- Current phase: ${phaseState.phase === "hpi_phase" ? "HPI_FIRST" : "FORM_CATCHUP"}\n- questionCountSoFar: ${phaseState.questionCountSoFar}\n- targetQuestionCount: ${phaseState.targetQuestionCount}\n- secondHalfStart: ${phaseState.secondHalfStart}\n- Safety-critical or urgent clarification questions can be asked in any phase.\n- Precedence: safety-critical > complaint-scoped red flags > HPI-first sequencing > form completion.\n\nPHASE RULES:\n${phaseState.phase === "hpi_phase" ? "1) Focus on HPI and complaint-scoped clinical reasoning.\n2) Defer non-urgent form-only administrative questions until FORM_CATCHUP phase.\n3) You may ask urgent form-linked safety questions earlier if clinically necessary." : "1) Continue clinical safety checks, but prioritize remaining form-completion items.\n2) Ask targeted form questions now so the physician can mostly complete the form from your summary.\n3) Do not finish with summary while major required form items remain unaddressed unless the patient explicitly stops the interview."}`
    : "";
  const formCoverageSection = phaseState.hasStructuredForm && formCoverageHints.length > 0
    ? `\n\nFORM COVERAGE REMINDER:\n${remainingFormCoverageHints.length > 0 ? `Remaining likely form items to capture:\n${remainingFormCoverageHints.map((item, i) => `  ${i + 1}. ${item}`).join("\n")}` : "No obvious uncovered form buckets detected from the current transcript. Confirm any final required fields, then proceed."}`
    : "";
  const doNotAskAboutSection = hasMultipleComplaints && remainingComplaints.length > 0
    ? `\n\n🚫 DO NOT ASK ABOUT (FORBIDDEN UNTIL CURRENT COMPLAINT IS COMPLETE):\n${remainingComplaints.map((c, i) => `  - Complaint #${currentComplaintIndex + 2 + i}: "${c}"`).join("\n")}\n\nCRITICAL: You are FORBIDDEN from asking questions about these complaints until you have completed ALL questions and red flag assessment for "${currentComplaint}". Before asking each question, verify it relates ONLY to "${currentComplaint}". If your question relates to any of the forbidden complaints above, you MUST wait.`
    : "";
  const completedComplaintsSection = hasMultipleComplaints && completedComplaintsList.length > 0
    ? `\n\n✅ COMPLETED COMPLAINTS:\n${completedComplaintsList.map((c) => `  - ${c}`).join("\n")}\n\nThese complaints have been fully explored. Do NOT ask about them again unless clarifying information is needed.`
    : "";
  const currentComplaintNote = hasMultipleComplaints && currentComplaintIndex < complaints.length
    ? `\n\n🎯 CURRENT FOCUS (CRITICAL - READ CAREFULLY):\nYou are currently addressing complaint #${currentComplaintIndex + 1}: "${currentComplaint}"\n\nCOMPLETION CRITERIA for this complaint:\n  1. All core symptom characteristics gathered (onset, duration, severity, quality, location, triggers, relieving factors)\n  2. ALL relevant red flags assessed (see checklist below)\n  3. All associated symptoms identified\n  4. Virtual physical exam completed if applicable\n  5. 12-25 focused questions asked\n\n${currentComplaintIndex < complaints.length - 1 ? `ONLY AFTER completing this complaint, you may move to complaint #${currentComplaintIndex + 2}: "${complaints[currentComplaintIndex + 1]}" without announcing the transition.` : "This is the last complaint. After completing it, provide a summary combining ALL complaints."}\n\nCRITICAL: Do NOT mention, ask about, or reference other complaints until this complaint is complete.`
    : `\n\n🎯 CURRENT FOCUS:\nYou are addressing: "${currentComplaint}"\n\nCOMPLETION CRITERIA:\n  1. All core symptom characteristics gathered\n  2. ALL relevant red flags assessed (see checklist below)\n  3. All associated symptoms identified\n  4. Virtual physical exam completed if applicable\n  5. 12-25 focused questions asked`;

  const fullPrompt = `
Chief complaint(s): ${chiefComplaint}
${complaintsList}
${completedComplaintsSection}${dynamicComplaintSection}${newlyQueuedConcernSection}
${currentComplaintNote}
${redFlagSection}
${doNotAskAboutSection}

Patient sex: ${profile.sex}
Patient age: ${profile.age}
Pertinent past medical history: ${profile.pmh}
Family history: ${profile.familyHistory}
Current medications (include OTC/supplements): ${profile.currentMedications}
Family doctor: ${profile.familyDoctor}
Documented drug allergies: ${profile.allergies}
${patientBackground ? `\nPhysician-provided background: ${patientBackground}` : ""}
${imageSection}${labReportSection}${formSection}${medPmhSection}
${sensitivePhotoDirective}
${transcriptSection}${transcriptNote}${questionsList}${topicsList}${informationAlreadyProvided}${openEndedReminder}${mvaFollowUpSection}${mskLocationDirective}${deferredIntentSection}${controllerSection}${interviewPhaseSection}${formCoverageSection}

CLINICAL INTERVIEW GUIDANCE (You are operating as a Physician Assistant):
${physicianGuidanceSection}
- DO NOT repeat the chief complaint verbatim. Rephrase it naturally into a clinical sentence when asking your first question.
- Bundle related red flags or associated symptoms into ONE question (enumerate items) rather than separate questions. Use yes/no or “which apply.” Example: “Have you had any of the following: uncontrolled bleeding from mouth/nose; rash, joint pain, or swelling; changes in your voice/hoarseness; difficulty opening your mouth?”
- If the complaint is visible (rash, lesion, wound, swelling, bruising, deformity, skin changes), proactively offer the patient the option to upload/share a photo unless one is already provided (imageSummary present).
- TOTAL QUESTIONS ALREADY ASKED: ${allQuestionsAsked.length}. Use the FOCUS CONTROLLER budget above instead of fixed exhaustive questioning.
- Be focused and efficient. Review the transcript carefully to avoid repetition. Ask only the most diagnostically important questions that contribute to your clinical assessment.
- Think clinically: Each question should help you rule in/out differential diagnoses, assess complaint-scoped red flags, and gather information needed for physician review.
- ${hasMultipleComplaints ? "Aim for efficient complaint-scoped questioning per complaint and complete ALL complaints before summarizing." : "Aim for efficient complaint-scoped questioning with minimal patient burden."}
- Before asking each question, verify it relates ONLY to the CURRENT complaint. If multiple complaints exist, you are FORBIDDEN from asking about other complaints until the current one is complete.
- When a physician form is present: prioritize HPI in the early half, then prioritize remaining form-required questions in the later half.

MANDATORY PRE-QUESTION VALIDATION (CRITICAL - MUST DO BEFORE EVERY QUESTION):
1. Read the "QUESTIONS ALREADY ASKED" list above (${allQuestionsAsked.length} questions total)
2. Read the "TOPICS ALREADY COVERED" list above
3. Formulate your intended question
4. Compare your intended question against ALL ${allQuestionsAsked.length} previous questions
5. Check if your question asks about any topic in the "TOPICS ALREADY COVERED" list
6. If your question is semantically similar to ANY previous question OR relates to a covered topic:
   - STOP immediately
   - Choose a DIFFERENT clinical topic that hasn't been covered
   - Formulate a NEW question about that different topic
7. Only proceed with your question if it's about a NEW topic that hasn't been covered

- Remember: Your goal is to gather enough information to form a clinical assessment (with differential diagnoses) for physician review, without giving treatment advice.

${forceSummary ? `CRITICAL: The patient has requested to end the interview. You MUST provide a summary now based on all the information gathered so far. Generate a comprehensive one-paragraph summary (max 1500 characters) that combines ALL complaints into a natural clinical narrative (e.g., "30 year old female with 3 days of vaginal discharge and 5 days of sore throat. The vaginal discharge is associated with itchiness..."). Your ASSESSMENT must include differential diagnoses, and your PLAN must remain physician-handoff only (no treatment recommendations).` : `CRITICAL SUMMARY CONDITIONS - As a Physician Assistant, only summarize when you have:
- ${hasMultipleComplaints ? "Fully explored ALL chief complaints (meaning ALL questions asked for ALL complaints)" : "Fully explored this complaint (meaning all questions asked)"}
- Assessed ALL critical red flags relevant to ${hasMultipleComplaints ? "ALL complaints" : "this complaint"} and ruled them out or confirmed them
- Gathered core symptom characteristics ${hasMultipleComplaints ? "for ALL complaints" : ""} (onset, duration, severity, quality, location, triggers, relieving factors)
- Identified key associated symptoms ${hasMultipleComplaints ? "for ALL complaints" : ""}
- Completed relevant virtual physical exam maneuvers if applicable (especially for MSK cases)
- Have enough information to form a clinical assessment with differential diagnoses ${hasMultipleComplaints ? "for ALL complaints" : ""}
- Have enough information for physician handoff and follow-up planning ${hasMultipleComplaints ? "for ALL complaints" : ""}
- ${hasMultipleComplaints ? "Explicit confirmation: You have asked comprehensive clinical questions for ALL complaints AND assessed red flags for ALL complaints AND can form differential diagnoses and physician-handoff recommendations" : "Explicit confirmation: You have asked comprehensive clinical questions and assessed all red flags and can form differential diagnoses and physician-handoff recommendations"}`}

If you still need more critical clinical information${forceSummary ? "" : " and the patient hasn't requested to end"}${forceSummary ? "" : ", respond with a JSON object shaped like {\"type\":\"question\",\"question\":\"...\",\"rationale\":\"...\",\"requiresPhotoUpload\":false}"}. The rationale should explain the clinical purpose of your question (e.g., "To assess for cardiac risk factors" or "To distinguish between viral and bacterial pharyngitis"). Set "requiresPhotoUpload": true only when the question explicitly asks for image upload/share/send/take.
If you have sufficient information for a clinical assessment with differential diagnoses and physician handoff${forceSummary ? " or the patient has requested to end" : " (typically when complaint-scoped data is sufficient and relevant red flags are addressed)"}, OR if the FOCUS CONTROLLER says early-stop is met, respond with {"type":"summary","positives":[],"negatives":[],"summary":"","investigations":[],"assessment":"","plan":[]}. Remember: Your assessment must include differential diagnoses, and your plan must avoid treatment/medication advice and focus on physician handoff.

CRITICAL: You MUST respond with valid JSON only. Do not include any text before or after the JSON object. Ensure all strings are properly escaped and all JSON syntax is correct.
${languageSection}
  `.trim();

  if (process.env.NODE_ENV === "development") {
    console.log("[interview-route] Full prompt length:", fullPrompt.length);
  }

  return fullPrompt;
}
