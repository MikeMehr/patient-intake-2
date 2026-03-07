import type { PatientProfile, InterviewMessage } from "@/lib/interview-schema";
import {
  computeFormInterviewPhase,
  getFormCoverageHints,
  getRemainingFormCoverageHints,
} from "./prompt-helpers";
import { classifyComplaint, getComplaintProtocol } from "./complaint-protocols";
import { classifyVisitStage } from "./visit-stage";
import type {
  ComplaintProgress,
  InterviewFactSummary,
  InterviewState,
  ProtocolCheck,
  ProtocolTopicKey,
} from "./protocol-types";

const BASE_QUESTION_BUDGET = 15;
const FATIGUE_PHRASES = [
  "i already answered",
  "already answered that",
  "too many questions",
  "stop asking",
  "you asked that",
  "enough questions",
];

function extractTopics(question: string): ProtocolTopicKey[] {
  const qLower = question.toLowerCase();
  const topics: ProtocolTopicKey[] = [];

  if (qLower.match(/\b(severity|severe|pain level|scale|0-10|how bad|intensity)\b/)) topics.push("severity");
  if (qLower.match(/\b(where|location|which area|where exactly|spot)\b/)) topics.push("location");
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
  if (qLower.match(/\b(range of motion|rom|move|bend|straighten|flex|extend)\b/))
    topics.push("range of motion");
  if (qLower.match(/\b(tenderness|tender|palpation|press|touch)\b/)) topics.push("tenderness");
  if (qLower.match(/\b(swelling|swollen|edema|bruising)\b/)) topics.push("swelling");
  if (qLower.match(/\b(redness|red|inflammation)\b/)) topics.push("redness");
  if (qLower.match(/\b(exudate|discharge|pus|white spots|drainage)\b/)) topics.push("exudate");
  if (qLower.match(/\b(shortness of breath|dyspnea|breathing|wheez|chest tightness)\b/))
    topics.push("respiratory");
  if (qLower.match(/\b(chest pain|cardiac|heart)\b/)) topics.push("cardiac symptoms");
  if (qLower.match(/\b(neurological|weakness|numbness|tingling|paralysis)\b/))
    topics.push("neurological");
  if (qLower.match(/\b(loss of consciousness|passed out|fainted|unconscious)\b/))
    topics.push("loss of consciousness");
  if (qLower.match(/\b(accident|mva|motor vehicle|car accident|collision)\b/))
    topics.push("accident details");
  if (qLower.match(/\b(seatbelt|airbag|ambulance|er|emergency room)\b/))
    topics.push("accident response");
  if (qLower.match(/\b(previous injury|prior injury|before this)\b/)) topics.push("previous injuries");
  if (qLower.match(/\b(improv|wors|same|unchanged|progress)\b/)) topics.push("interval change");
  if (qLower.match(/\b(current symptoms|still bothering|still having|what symptoms are still)\b/))
    topics.push("current symptoms");
  if (qLower.match(/\b(limit|limitation|activity|daily activity|sleep|function)\b/))
    topics.push("function impact");
  if (qLower.match(/\b(work|job|duties|modified duty|off work)\b/)) topics.push("work status");
  if (qLower.match(/\b(physio|physiotherapy|chiro|rehab|therapy|home exercises?)\b/))
    topics.push("rehab progress");
  if (qLower.match(/\b(new red flags|new weakness|new numbness|current red flags)\b/))
    topics.push("current red flags");
  if (qLower.match(/\b(fever|chills|fatigue|weight loss|appetite)\b/))
    topics.push("constitutional symptoms");

  return Array.from(new Set(topics));
}

function extractInformationFromAnswers(answers: string[]): InterviewFactSummary {
  if (answers.length === 0) {
    return {
      mentionedTopics: [],
      symptomDetails: [],
      redFlagsMentioned: [],
      informationSummary: "",
    };
  }

  const allAnswersText = answers.join(" ").toLowerCase();
  const mentionedTopics = new Set<ProtocolTopicKey>();
  const symptomDetails: string[] = [];
  const redFlagsMentioned: string[] = [];

  if (allAnswersText.match(/\b(\d+\/10|\d+ out of 10|mild|moderate|severe|very severe)\b/i)) {
    mentionedTopics.add("severity");
  }
  if (allAnswersText.match(/\b(knee|shoulder|back|neck|arm|leg|chest|throat|abdomen|stomach|head)\b/)) {
    mentionedTopics.add("location");
  }
  if (allAnswersText.match(/\b(\d+\s*(day|week|month|hour|minute)s?)\b/i)) {
    mentionedTopics.add("duration/onset");
  }
  if (allAnswersText.match(/\b(sharp|dull|aching|burning|throbbing|pressure)\b/)) {
    mentionedTopics.add("quality");
  }
  if (allAnswersText.match(/\b(worse|worsens|aggravates|trigger|provokes|after)\b/)) {
    mentionedTopics.add("triggers");
  }
  if (allAnswersText.match(/\b(better|helps|improves|relief|rest|ice|heat|medication)\b/)) {
    mentionedTopics.add("relieving factors");
  }
  if (allAnswersText.match(/\b(nausea|fever|chills|dizziness|cough|congestion|numbness|weakness)\b/)) {
    mentionedTopics.add("associated symptoms");
  }
  if (allAnswersText.match(/\b(can't move|limited|stiff|range of motion|bend|straighten|flex)\b/)) {
    mentionedTopics.add("range of motion");
  }
  if (allAnswersText.match(/\b(tender|tenderness|hurts when touched|painful when pressed)\b/)) {
    mentionedTopics.add("tenderness");
  }
  if (allAnswersText.match(/\b(swelling|swollen|puffy|bruising)\b/)) {
    mentionedTopics.add("swelling");
  }
  if (allAnswersText.match(/\b(redness|red|inflamed)\b/)) {
    mentionedTopics.add("redness");
  }
  if (allAnswersText.match(/\b(discharge|pus|drainage|white spots)\b/)) {
    mentionedTopics.add("exudate");
  }
  if (allAnswersText.match(/\b(shortness of breath|dyspnea|difficulty breathing|wheez)\b/)) {
    mentionedTopics.add("respiratory");
    redFlagsMentioned.push("respiratory");
  }
  if (allAnswersText.match(/\b(chest pain|pressure|heart)\b/)) {
    mentionedTopics.add("cardiac symptoms");
    redFlagsMentioned.push("cardiac symptoms");
  }
  if (allAnswersText.match(/\b(weakness|numbness|tingling|loss of sensation)\b/)) {
    mentionedTopics.add("neurological");
    redFlagsMentioned.push("neurological");
  }
  if (allAnswersText.match(/\b(loss of consciousness|passed out|fainted|blacked out|memory gap|amnesia)\b/)) {
    mentionedTopics.add("loss of consciousness");
    redFlagsMentioned.push("loss of consciousness");
  }
  if (allAnswersText.match(/\b(accident|mva|motor vehicle|collision|rear-ended)\b/)) {
    mentionedTopics.add("accident details");
  }
  if (allAnswersText.match(/\b(seatbelt|airbag|ambulance|emergency room|er)\b/)) {
    mentionedTopics.add("accident response");
  }
  if (allAnswersText.match(/\b(previous injury|prior injury|before this)\b/)) {
    mentionedTopics.add("previous injuries");
  }
  if (allAnswersText.match(/\b(improved|improving|worse|worsening|same|unchanged|still)\b/)) {
    mentionedTopics.add("interval change");
  }
  if (allAnswersText.match(/\b(still|currently|right now|at this point)\b/)) {
    mentionedTopics.add("current symptoms");
    mentionedTopics.add("current red flags");
  }
  if (allAnswersText.match(/\b(limit|limitation|daily activities|sleep|can't do|hard to)\b/)) {
    mentionedTopics.add("function impact");
  }
  if (allAnswersText.match(/\b(work|job|modified duty|off work|return to work)\b/)) {
    mentionedTopics.add("work status");
  }
  if (allAnswersText.match(/\b(physio|physiotherapy|chiro|rehab|therapy|home exercise)\b/)) {
    mentionedTopics.add("rehab progress");
  }
  if (allAnswersText.match(/\b(fever|chills|fatigue|weight loss|appetite)\b/)) {
    mentionedTopics.add("constitutional symptoms");
  }

  const durationMatch = allAnswersText.match(/\b(\d+\s*(day|week|month|hour|minute)s?)\b/i);
  if (durationMatch) symptomDetails.push(`Duration: ${durationMatch[0]}`);
  const severityMatch = allAnswersText.match(/\b(\d+\/10|\d+ out of 10|mild|moderate|severe)\b/i);
  if (severityMatch) symptomDetails.push(`Severity: ${severityMatch[0]}`);

  return {
    mentionedTopics: Array.from(mentionedTopics),
    symptomDetails,
    redFlagsMentioned,
    informationSummary: symptomDetails.join("; "),
  };
}

function detectFatigueSignals(patientAnswers: string[]) {
  const lowerAnswers = patientAnswers.map((answer) => answer.toLowerCase().trim()).filter(Boolean);
  const signals: string[] = [];

  if (lowerAnswers.some((answer) => FATIGUE_PHRASES.some((phrase) => answer.includes(phrase)))) {
    signals.push("explicit-fatigue-statement");
  }

  const oneWordCount = lowerAnswers.filter((answer) => answer.split(/\s+/).length <= 1).length;
  if (lowerAnswers.length >= 3 && oneWordCount >= Math.ceil(lowerAnswers.length * 0.6)) {
    signals.push("predominantly-one-word-responses");
  }

  return { active: signals.length > 0, signals };
}

function detectEscalationState(params: {
  chiefComplaint: string;
  activeComplaint: string;
  patientProfile: PatientProfile;
  patientAnswers: string[];
  formSummary: string | null;
}) {
  const text = `${params.chiefComplaint} ${params.activeComplaint}`.toLowerCase();
  const answersText = params.patientAnswers.join(" ").toLowerCase();
  const profileText = `${params.patientProfile.pmh} ${params.patientProfile.currentMedications}`.toLowerCase();
  const formText = (params.formSummary || "").toLowerCase();

  const hasRedFlagSignal = Boolean(
    `${text} ${answersText}`.match(
      /\b(loss of consciousness|faint|syncope|hemoptysis|gi bleed|melena|hematemesis|vision loss|focal weakness|severe pain|thunderclap)\b/,
    ),
  );
  const hasMultiSystemSymptoms = Boolean(
    `${text} ${answersText}`.match(
      /\b(chest pain.*shortness of breath|headache.*neurologic|abdominal pain.*vomit|multiple complaints|and also)\b/,
    ),
  );
  const hasChronicComplexity = Boolean(
    profileText.match(/\b(diabetes|copd|chf|heart failure|ckd|kidney disease|cancer|immunosupp|cirrhosis|anticoagulant|pregnan)\b/),
  );
  const hasStructuredFormUpload = formText.length > 0;
  const isTraumaOrMva = classifyComplaint(params.activeComplaint) === "Trauma";

  return {
    active: hasRedFlagSignal || hasMultiSystemSymptoms || hasChronicComplexity || hasStructuredFormUpload || isTraumaOrMva,
    hasRedFlagSignal,
    hasMultiSystemSymptoms,
    hasChronicComplexity,
    hasStructuredFormUpload,
    isTraumaOrMva,
  };
}

function computeQuestionBudget(escalation: ReturnType<typeof detectEscalationState>) {
  if (escalation.hasStructuredFormUpload) {
    return { budget: null, modifiers: ["unlimited-structured-form"] };
  }

  let budget = BASE_QUESTION_BUDGET;
  const modifiers = [`base:${BASE_QUESTION_BUDGET}`];
  if (escalation.hasRedFlagSignal) {
    budget += 5;
    modifiers.push("+5-red-flag");
  }
  if (escalation.hasMultiSystemSymptoms) {
    budget += 5;
    modifiers.push("+5-multi-system");
  }
  if (escalation.hasChronicComplexity) {
    budget += 5;
    modifiers.push("+5-chronic-complexity");
  }
  if (escalation.isTraumaOrMva) {
    budget += 15;
    modifiers.push("+15-trauma-mva");
  }
  return { budget, modifiers };
}

function splitComplaints(chiefComplaint: string) {
  return chiefComplaint
    .split(/[,\n]| and |; /)
    .map((complaint) => complaint.trim())
    .filter((complaint) => complaint.length > 0);
}

function determineComplaintProgress(params: {
  complaint: string;
  transcriptText: string;
  allQuestionsAsked: string[];
}): { ratio: number; questionCount: number; completed: boolean } {
  const complaintKeywords = params.complaint.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
  const coverage = complaintKeywords.filter((keyword) => params.transcriptText.includes(keyword)).length;
  const ratio = complaintKeywords.length > 0 ? coverage / complaintKeywords.length : 0;
  const questionCount = params.allQuestionsAsked.filter((question) =>
    complaintKeywords.some((keyword) => question.toLowerCase().includes(keyword)),
  ).length;
  return {
    ratio,
    questionCount,
    completed: ratio >= 0.5 && questionCount >= 4,
  };
}

function resolveActiveComplaint(params: {
  chiefComplaint: string;
  transcript: InterviewMessage[];
  allQuestionsAsked: string[];
}) {
  const complaints = splitComplaints(params.chiefComplaint);
  if (complaints.length <= 1) {
    return {
      complaints: complaints.length === 0 ? [params.chiefComplaint] : complaints,
      activeComplaintIndex: 0,
      completedComplaints: [],
    };
  }

  const transcriptText = params.transcript.map((message) => message.content).join(" ").toLowerCase();
  const progress = complaints.map((complaint) =>
    determineComplaintProgress({
      complaint,
      transcriptText,
      allQuestionsAsked: params.allQuestionsAsked,
    }),
  );

  let activeComplaintIndex = 0;
  const completedComplaints: string[] = [];
  progress.forEach((item, index) => {
    if (item.completed && index < complaints.length - 1) {
      completedComplaints.push(complaints[index]);
    }
  });

  const lastCoveredIndex = progress.findLastIndex((item) => item.ratio >= 0.5);
  if (lastCoveredIndex >= 0) {
    activeComplaintIndex =
      progress[lastCoveredIndex].completed && lastCoveredIndex < complaints.length - 1
        ? lastCoveredIndex + 1
        : lastCoveredIndex;
  }

  return { complaints, activeComplaintIndex, completedComplaints };
}

function isCovered(check: ProtocolCheck, coveredTopics: Set<ProtocolTopicKey>, patientAnswers: string[]) {
  if (check.key === "open_narrative") {
    return patientAnswers.length > 0;
  }
  return check.coverageTopics.some((topic) => coveredTopics.has(topic));
}

function detectUnresolvedClarification(patientAnswers: string[]) {
  const lastAnswer = patientAnswers.at(-1)?.trim().toLowerCase() ?? "";
  if (!lastAnswer) return null;
  if (
    /\b(not sure|i don't know|idk|maybe|stuff|things|what do you mean|don't understand)\b/.test(lastAnswer)
  ) {
    return lastAnswer;
  }
  return null;
}

function buildComplaintProgress(args: {
  activeComplaint: string;
  coveredTopics: Set<ProtocolTopicKey>;
  patientAnswers: string[];
  protocol: ReturnType<typeof getComplaintProtocol>;
}): ComplaintProgress {
  const missingRequiredFields = args.protocol.requiredFields.filter(
    (check) => !isCovered(check, args.coveredTopics, args.patientAnswers),
  );
  const missingRedFlags = args.protocol.redFlags.filter(
    (check) => !isCovered(check, args.coveredTopics, args.patientAnswers),
  );
  const missingVirtualExamFields = args.protocol.virtualExamFields.filter(
    (check) => !isCovered(check, args.coveredTopics, args.patientAnswers),
  );

  return {
    complaint: args.activeComplaint,
    complaintClass: args.protocol.complaintClass,
    protocolId: args.protocol.id,
    coveredTopics: Array.from(args.coveredTopics),
    missingRequiredFieldKeys: missingRequiredFields.map((item) => item.key),
    missingRedFlagKeys: missingRedFlags.map((item) => item.key),
    missingVirtualExamKeys: missingVirtualExamFields.map((item) => item.key),
    completed:
      missingRequiredFields.length === 0 &&
      missingRedFlags.length === 0 &&
      missingVirtualExamFields.length === 0,
  };
}

export function buildInterviewState(params: {
  chiefComplaint: string;
  patientProfile: PatientProfile;
  transcript: InterviewMessage[];
  formSummary: string | null;
  patientBackground: string | null;
  forceSummary: boolean;
  deferredIntentHint: string | null;
}): InterviewState {
  const allQuestionsAsked = params.transcript
    .filter((message) => message.role === "assistant")
    .map((message) => message.content.trim())
    .filter(Boolean);
  const patientAnswers = params.transcript
    .filter((message) => message.role === "patient")
    .map((message) => message.content.trim())
    .filter(Boolean);

  const topicsCovered = new Set<ProtocolTopicKey>();
  allQuestionsAsked.forEach((question) => {
    extractTopics(question).forEach((topic) => topicsCovered.add(topic));
  });

  const patientFacts = extractInformationFromAnswers(patientAnswers);
  patientFacts.mentionedTopics.forEach((topic) => topicsCovered.add(topic));

  const complaintResolution = resolveActiveComplaint({
    chiefComplaint: params.chiefComplaint,
    transcript: params.transcript,
    allQuestionsAsked,
  });
  const activeComplaint =
    complaintResolution.complaints[complaintResolution.activeComplaintIndex] ?? params.chiefComplaint;
  const complaintClass = classifyComplaint(activeComplaint || params.chiefComplaint);
  const visitStage = classifyVisitStage({
    chiefComplaint: params.chiefComplaint,
    activeComplaint,
    patientBackground: params.patientBackground,
    formSummary: params.formSummary,
    patientAnswers,
  });
  const protocol = getComplaintProtocol({
    complaint: activeComplaint,
    complaintClass,
    visitStage,
  });

  const missingRequiredFields = protocol.requiredFields.filter(
    (check) => !isCovered(check, topicsCovered, patientAnswers),
  );
  const missingRedFlags = protocol.redFlags.filter(
    (check) => !isCovered(check, topicsCovered, patientAnswers),
  );
  const missingVirtualExamFields = protocol.virtualExamFields.filter(
    (check) => !isCovered(check, topicsCovered, patientAnswers),
  );

  const escalation = detectEscalationState({
    chiefComplaint: params.chiefComplaint,
    activeComplaint,
    patientProfile: params.patientProfile,
    patientAnswers,
    formSummary: params.formSummary,
  });
  const budget = computeQuestionBudget(escalation);
  const phaseState = computeFormInterviewPhase({
    hasStructuredForm: escalation.hasStructuredFormUpload,
    questionCountSoFar: allQuestionsAsked.length,
    budget,
    escalation: {
      hasRedFlagSignal: escalation.hasRedFlagSignal,
      hasMultiSystemSymptoms: escalation.hasMultiSystemSymptoms,
      isTraumaOrMva: escalation.isTraumaOrMva,
    },
    hasMultipleComplaints: complaintResolution.complaints.length > 1,
  });
  const formCoverageHints = getFormCoverageHints(params.formSummary);
  const remainingFormCoverageHints = getRemainingFormCoverageHints({
    formHints: formCoverageHints,
    allQuestionsAsked,
    patientAnswers,
    topicsCovered,
    patientMentionedTopics: patientFacts.mentionedTopics,
  });

  const fatigueSignals = detectFatigueSignals(patientAnswers);
  const reachedBudget = budget.budget !== null && allQuestionsAsked.length >= budget.budget;
  const hasFormCatchUpWork =
    phaseState.hasStructuredForm &&
    phaseState.phase === "form_phase" &&
    remainingFormCoverageHints.length > 0;
  const shouldEarlyStop =
    !params.forceSummary &&
    ((reachedBudget && !escalation.active && !phaseState.hasStructuredForm) ||
      (fatigueSignals.active && allQuestionsAsked.length >= 6)) &&
    !hasFormCatchUpWork &&
    !(phaseState.hasStructuredForm && phaseState.phase === "hpi_phase");

  const unresolvedClarification = detectUnresolvedClarification(patientAnswers);
  const summaryReady =
    params.forceSummary ||
    (!unresolvedClarification &&
      allQuestionsAsked.length >= protocol.stopConditions.minQuestionCount &&
      missingRequiredFields.length === 0 &&
      (!protocol.stopConditions.requireRedFlags || missingRedFlags.length === 0) &&
      (!protocol.stopConditions.requireVirtualExamWhenApplicable ||
        protocol.virtualExamFields.length === 0 ||
        missingVirtualExamFields.length === 0) &&
      (!phaseState.hasStructuredForm || remainingFormCoverageHints.length === 0 || shouldEarlyStop));

  return {
    chiefComplaint: params.chiefComplaint,
    complaints: complaintResolution.complaints,
    activeComplaint,
    activeComplaintIndex: complaintResolution.activeComplaintIndex,
    completedComplaints: complaintResolution.completedComplaints,
    complaintClass,
    visitStage,
    protocol,
    complaintProgress: buildComplaintProgress({
      activeComplaint,
      coveredTopics: topicsCovered,
      patientAnswers,
      protocol,
    }),
    questionCountSoFar: allQuestionsAsked.length,
    allQuestionsAsked,
    patientAnswers,
    coveredTopics: Array.from(topicsCovered),
    patientFacts,
    missingRequiredFields,
    missingRedFlags,
    missingVirtualExamFields,
    remainingFormCoverageHints,
    urgency:
      escalation.hasRedFlagSignal || (missingRedFlags.length > 0 && allQuestionsAsked.length >= 4)
        ? "elevated"
        : "routine",
    shouldEarlyStop,
    summaryReady,
    unresolvedClarification,
    deferredIntentHint: params.deferredIntentHint,
    forceSummary: params.forceSummary,
  };
}
