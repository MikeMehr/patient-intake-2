import { detectBodyParts } from "@/lib/body-parts";
import type {
  InterviewMessage,
  InterviewProgress,
  PatientProfile,
} from "@/lib/interview-schema";
import {
  computeFormInterviewPhase,
  getFormCoverageHints,
  getRemainingFormCoverageHints,
} from "./prompt-helpers";
import { classifyComplaint, getComplaintProtocol } from "./complaint-protocols";
import type { ComplaintSource, ComplaintStatus } from "./protocol-types";
import {
  type ComplaintProgress,
  type InterviewFactSummary,
  type InterviewState,
  type ProtocolCheck,
  type ProtocolTopicKey,
} from "./protocol-types";
import { classifyVisitStage } from "./visit-stage";

const BASE_QUESTION_BUDGET = 15;
const NEW_COMPLAINT_BUDGET_BONUS = 8;
const FATIGUE_PHRASES = [
  "i already answered",
  "already answered that",
  "too many questions",
  "stop asking",
  "you asked that",
  "enough questions",
];
const DYNAMIC_COMPLAINT_CUE_PATTERN =
  /\b(also|another|additionally|in addition|plus|as well|too|besides|separately|now having|also having)\b/;
const CONCERN_STYLE_CUE_PATTERN =
  /\b(regarding|worried about|concerned about|questions? about|what should i do(?: next)? about|what do i do about|help with|guidance about|asking about)\b/;
const SYMPTOM_CONTEXT_PATTERN =
  /\b(pain|painful|hurt|hurts|hurting|ache|aching|swelling|swollen|lump|rash|lesion|wound|ulcer|numb|tingling|weakness|stiff|stiffness|cough|shortness of breath|dyspnea|headache|discharge|sore throat|fever|abdomen|abdominal|nausea|vomit)\b/;
const MARKER_ONLY_PATTERN =
  /\b(marked|mark|clicked|tapped|placed an x|placed x|diagram|photo|image)\b/;
const MEDICAL_CONCERN_KEYWORD_PATTERN =
  /\b(prediabet(?:es|ic)?|diabet(?:es|ic)?|blood sugar|glucose|a1c|hba1c|cholesterol|lipid|triglyceride|blood pressure|hypertension|thyroid|kidney|renal|liver|hepat|anemia|iron|vitamin d|vitamin b12|test result|lab result|labs?)\b/;
const CONCERN_EXTRACT_PATTERNS = [
  /\b(?:also\s+)?regarding\s+([^.!?\n]+)/i,
  /\b(?:i am|i'm|im)?\s*(?:also\s+)?worried about\s+([^.!?\n]+)/i,
  /\b(?:i am|i'm|im)?\s*(?:also\s+)?concerned about\s+([^.!?\n]+)/i,
  /\bquestions?\s+about\s+([^.!?\n]+)/i,
  /\bwhat should i do(?: next)? about\s+([^.!?\n]+)/i,
  /\bwhat do i do about\s+([^.!?\n]+)/i,
  /\bhelp with\s+([^.!?\n]+)/i,
  /\bguidance about\s+([^.!?\n]+)/i,
];
const COMPLAINT_KEYWORD_STOPWORDS = new Set([
  "right",
  "left",
  "both",
  "pain",
  "with",
  "from",
  "that",
  "this",
  "have",
  "having",
  "also",
  "behind",
  "around",
  "area",
  "side",
  "concern",
  "function",
  "issue",
  "issues",
  "management",
]);
const NON_MSK_DYNAMIC_COMPLAINTS = [
  { pattern: /\bchest pain\b/, label: "chest pain" },
  { pattern: /\bshortness of breath|dyspnea\b/, label: "shortness of breath" },
  { pattern: /\bsore throat\b/, label: "sore throat" },
  { pattern: /\bheadache|migraine\b/, label: "headache" },
  { pattern: /\babdominal pain|stomach pain\b/, label: "abdominal pain" },
  { pattern: /\brash|skin lesion|skin wound|hives\b/, label: "rash" },
];
const CONDITION_LAB_DYNAMIC_COMPLAINTS = [
  {
    pattern:
      /\b(prediabet(?:es|ic)?|diabet(?:es|ic)?|blood sugar|glucose|a1c|hba1c|sugar management)\b/,
    label: "blood sugar concern",
  },
  { pattern: /\b(blood pressure|hypertension)\b/, label: "blood pressure concern" },
  { pattern: /\b(cholesterol|lipid|triglyceride)\b/, label: "cholesterol concern" },
  { pattern: /\b(thyroid|tsh)\b/, label: "thyroid concern" },
  { pattern: /\b(kidney|renal|creatinine|egfr)\b/, label: "kidney function concern" },
  { pattern: /\b(liver|hepatic|alt|ast)\b/, label: "liver function concern" },
  { pattern: /\b(anemia|iron|ferritin|hemoglobin)\b/, label: "anemia or iron concern" },
];

type ComplaintSeed = {
  complaint: string;
  source: ComplaintSource;
  addedMidInterview: boolean;
  firstDetectedAtMessageIndex: number | null;
};

type ComplaintScopeAccumulator = {
  assistantQuestions: string[];
  activeAssistantQuestions: string[];
  patientAnswers: string[];
};

type EvaluatedComplaintScope = {
  complaintClass: ReturnType<typeof classifyComplaint>;
  visitStage: ReturnType<typeof classifyVisitStage>;
  protocol: ReturnType<typeof getComplaintProtocol>;
  coveredTopics: Set<ProtocolTopicKey>;
  patientFacts: InterviewFactSummary;
  missingRequiredFields: ProtocolCheck[];
  missingRedFlags: ProtocolCheck[];
  missingVirtualExamFields: ProtocolCheck[];
  completed: boolean;
};

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
  if (
    allAnswersText.match(
      /\b(knee|elbow|shoulder|wrist|hand|foot|ankle|back|neck|arm|leg|chest|throat|abdomen|stomach|head)\b/,
    )
  ) {
    mentionedTopics.add("location");
  }
  if (allAnswersText.match(/\b(\d+\s*(day|week|month|hour|minute)s?)\b/i)) {
    mentionedTopics.add("duration/onset");
  }
  if (allAnswersText.match(/\b(sharp|dull|aching|burning|throbbing|pressure|soft|firm|hard)\b/)) {
    mentionedTopics.add("quality");
  }
  if (allAnswersText.match(/\b(worse|worsens|aggravates|trigger|provokes|after)\b/)) {
    mentionedTopics.add("triggers");
  }
  if (allAnswersText.match(/\b(better|helps|improves|relief|rest|ice|heat|medication|brace)\b/)) {
    mentionedTopics.add("relieving factors");
  }
  if (allAnswersText.match(/\b(nausea|fever|chills|dizziness|cough|congestion|numbness|weakness)\b/)) {
    mentionedTopics.add("associated symptoms");
  }
  if (allAnswersText.match(/\b(can't move|limited|stiff|range of motion|bend|straighten|flex|extend)\b/)) {
    mentionedTopics.add("range of motion");
  }
  if (allAnswersText.match(/\b(tender|tenderness|hurts when touched|painful when pressed)\b/)) {
    mentionedTopics.add("tenderness");
  }
  if (allAnswersText.match(/\b(swelling|swollen|puffy|bruising|lump)\b/)) {
    mentionedTopics.add("swelling");
  }
  if (allAnswersText.match(/\b(redness|red|inflamed|warmth|warm)\b/)) {
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
  if (allAnswersText.match(/\b(limit|limitation|daily activities|sleep|can't do|hard to|driving)\b/)) {
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

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function splitComplaints(chiefComplaint: string) {
  return chiefComplaint
    .split(/[,\n]| and |; /)
    .map((complaint) => complaint.trim())
    .filter((complaint) => complaint.length > 0);
}

function getComplaintKeywords(complaint: string) {
  return normalizeText(complaint)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !COMPLAINT_KEYWORD_STOPWORDS.has(word));
}

function complaintsAreEquivalent(left: string, right: string) {
  const leftNormalized = normalizeText(left);
  const rightNormalized = normalizeText(right);
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;
  if (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized)) return true;

  const leftParts = new Set(detectBodyParts(left).map((part) => part.part));
  const rightParts = new Set(detectBodyParts(right).map((part) => part.part));
  if (leftParts.size > 0 && rightParts.size > 0) {
    for (const part of leftParts) {
      if (rightParts.has(part)) {
        return true;
      }
    }
    return false;
  }

  const leftKeywords = new Set(getComplaintKeywords(left));
  const rightKeywords = new Set(getComplaintKeywords(right));
  let overlap = 0;
  for (const keyword of leftKeywords) {
    if (rightKeywords.has(keyword)) {
      overlap += 1;
    }
  }
  return overlap >= 2;
}

function extractConcernPhrases(message: string) {
  return CONCERN_EXTRACT_PATTERNS.flatMap((pattern) => {
    const match = message.match(pattern);
    if (!match?.[1]) return [];
    return [match[1].trim()];
  });
}

function cleanupConcernPhrase(phrase: string) {
  return phrase
    .replace(/^(?:my|the|his|her|their|our)\s+/i, "")
    .replace(/\b(?:management|issue|issues|problem|problems|concern|concerns)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractConcernStyleCandidates(message: string): string[] {
  const lower = message.toLowerCase();
  if (!CONCERN_STYLE_CUE_PATTERN.test(lower) && !DYNAMIC_COMPLAINT_CUE_PATTERN.test(lower)) {
    return [];
  }

  const candidates: string[] = [];
  CONDITION_LAB_DYNAMIC_COMPLAINTS.forEach((item) => {
    if (item.pattern.test(lower)) {
      candidates.push(item.label);
    }
  });

  extractConcernPhrases(message).forEach((phrase) => {
    const cleanedPhrase = cleanupConcernPhrase(phrase);
    if (!cleanedPhrase) return;

    const lowerPhrase = cleanedPhrase.toLowerCase();
    if (CONDITION_LAB_DYNAMIC_COMPLAINTS.some((item) => item.pattern.test(lowerPhrase))) {
      return;
    }

    const hasBodyPart = detectBodyParts(cleanedPhrase).length > 0;
    const hasKnownComplaintClass = classifyComplaint(cleanedPhrase) !== "General";
    const hasMedicalConcernKeyword = MEDICAL_CONCERN_KEYWORD_PATTERN.test(lowerPhrase);

    if (hasBodyPart || hasKnownComplaintClass || hasMedicalConcernKeyword) {
      candidates.push(cleanedPhrase);
    }
  });

  return Array.from(new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)));
}

function extractDynamicComplaintCandidates(
  message: string,
  patientTurnIndex: number,
): string[] {
  const lower = message.toLowerCase();
  if (patientTurnIndex === 0) return [];
  const hasSymptomCue = DYNAMIC_COMPLAINT_CUE_PATTERN.test(lower);
  const hasConcernCue = CONCERN_STYLE_CUE_PATTERN.test(lower);
  if (!hasSymptomCue && !hasConcernCue) return [];

  const candidates: string[] = [];
  if (hasSymptomCue && SYMPTOM_CONTEXT_PATTERN.test(lower)) {
    detectBodyParts(message).forEach((part) => {
      const side = part.side ? `${part.side} ` : "";
      if (/\b(lump|mass|bump)\b/.test(lower)) {
        candidates.push(`${side}${part.name} lump`);
        return;
      }
      if (/\b(rash|lesion|wound|ulcer)\b/.test(lower)) {
        candidates.push(`${side}${part.name} rash`);
        return;
      }
      candidates.push(`${side}${part.name} pain`);
    });

    if (candidates.length === 0) {
      NON_MSK_DYNAMIC_COMPLAINTS.forEach((item) => {
        if (item.pattern.test(lower)) {
          candidates.push(item.label);
        }
      });
    }
  }

  extractConcernStyleCandidates(message).forEach((candidate) => {
    candidates.push(candidate);
  });

  return Array.from(new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)));
}

function buildComplaintSeeds(chiefComplaint: string, transcript: InterviewMessage[]): ComplaintSeed[] {
  const seeds: ComplaintSeed[] = splitComplaints(chiefComplaint).map((complaint) => ({
    complaint,
    source: "chief_complaint",
    addedMidInterview: false,
    firstDetectedAtMessageIndex: null,
  }));

  const patientMessages = transcript.filter((message) => message.role === "patient");
  patientMessages.forEach((message, patientTurnIndex) => {
    const transcriptIndex = transcript.findIndex((item) => item === message);
    extractDynamicComplaintCandidates(message.content, patientTurnIndex).forEach((candidate) => {
      const alreadyTracked = seeds.some((seed) => complaintsAreEquivalent(seed.complaint, candidate));
      if (!alreadyTracked) {
        seeds.push({
          complaint: candidate,
          source: "transcript",
          addedMidInterview: true,
          firstDetectedAtMessageIndex: transcriptIndex >= 0 ? transcriptIndex : null,
        });
      }
    });
  });

  if (seeds.length === 0) {
    return [
      {
        complaint: chiefComplaint,
        source: "chief_complaint",
        addedMidInterview: false,
        firstDetectedAtMessageIndex: null,
      },
    ];
  }

  return seeds;
}

function messageMentionsComplaint(message: string, complaint: string) {
  const lowerMessage = message.toLowerCase();
  const complaintText = complaint.toLowerCase();
  if (lowerMessage.includes(complaintText)) return true;

  const complaintParts = new Set(detectBodyParts(complaint).map((part) => part.part));
  const messageParts = new Set(detectBodyParts(message).map((part) => part.part));
  if (complaintParts.size > 0 && messageParts.size > 0) {
    for (const part of complaintParts) {
      if (messageParts.has(part)) {
        return true;
      }
    }
  }

  const complaintKeywords = getComplaintKeywords(complaint);
  if (complaintKeywords.length === 0) return false;
  return complaintKeywords.some((keyword) => lowerMessage.includes(keyword));
}

function hasMeaningfulNarrative(patientAnswers: string[]) {
  return patientAnswers.some((answer) => {
    const lower = answer.toLowerCase().trim();
    if (!lower) return false;
    if (MARKER_ONLY_PATTERN.test(lower) && lower.split(/\s+/).length <= 8) {
      return false;
    }
    return lower.split(/\s+/).length >= 4;
  });
}

function looksLikeFollowUpAnswer(answer: string) {
  return /^(yes|no|it|they|there|none|not|soft|firm|hard|aching|sharp|dull|started|about|for|since|\d)/i.test(
    answer.trim(),
  );
}

function isCovered(check: ProtocolCheck, coveredTopics: Set<ProtocolTopicKey>, patientAnswers: string[]) {
  if (check.key === "open_narrative") {
    return hasMeaningfulNarrative(patientAnswers);
  }
  return check.coverageTopics.some((topic) => coveredTopics.has(topic));
}

function evaluateComplaintScope(params: {
  chiefComplaint: string;
  complaint: string;
  patientBackground: string | null;
  formSummary: string | null;
  scope: ComplaintScopeAccumulator;
}): EvaluatedComplaintScope {
  const coveredTopics = new Set<ProtocolTopicKey>();
  params.scope.assistantQuestions.forEach((question) => {
    extractTopics(question).forEach((topic) => coveredTopics.add(topic));
  });

  const patientFacts = extractInformationFromAnswers(params.scope.patientAnswers);
  patientFacts.mentionedTopics.forEach((topic) => coveredTopics.add(topic));

  const complaintClass = classifyComplaint(params.complaint);
  const visitStage = classifyVisitStage({
    chiefComplaint: params.chiefComplaint,
    activeComplaint: params.complaint,
    patientBackground: params.patientBackground,
    formSummary: params.formSummary,
    patientAnswers: params.scope.patientAnswers,
  });
  const protocol = getComplaintProtocol({
    complaint: params.complaint,
    complaintClass,
    visitStage,
  });
  const missingRequiredFields = protocol.requiredFields.filter(
    (check) => !isCovered(check, coveredTopics, params.scope.patientAnswers),
  );
  const missingRedFlags = protocol.redFlags.filter(
    (check) => !isCovered(check, coveredTopics, params.scope.patientAnswers),
  );
  const missingVirtualExamFields = protocol.virtualExamFields.filter(
    (check) => !isCovered(check, coveredTopics, params.scope.patientAnswers),
  );

  return {
    complaintClass,
    visitStage,
    protocol,
    coveredTopics,
    patientFacts,
    missingRequiredFields,
    missingRedFlags,
    missingVirtualExamFields,
    completed:
      params.scope.assistantQuestions.length >= protocol.stopConditions.minQuestionCount &&
      missingRequiredFields.length === 0 &&
      (!protocol.stopConditions.requireRedFlags || missingRedFlags.length === 0) &&
      (!protocol.stopConditions.requireVirtualExamWhenApplicable ||
        protocol.virtualExamFields.length === 0 ||
        missingVirtualExamFields.length === 0),
  };
}

function buildComplaintScopes(params: {
  chiefComplaint: string;
  complaintSeeds: ComplaintSeed[];
  transcript: InterviewMessage[];
  patientBackground: string | null;
  formSummary: string | null;
}) {
  const scopes = params.complaintSeeds.map<ComplaintScopeAccumulator>(() => ({
    assistantQuestions: [],
    activeAssistantQuestions: [],
    patientAnswers: [],
  }));
  let activeComplaintIndex = 0;

  params.transcript.forEach((message) => {
    const explicitMatches = params.complaintSeeds
      .map((seed, index) => (messageMentionsComplaint(message.content, seed.complaint) ? index : -1))
      .filter((index) => index >= 0);
    const targetIndices =
      explicitMatches.length > 0
        ? Array.from(new Set(explicitMatches))
        : activeComplaintIndex < params.complaintSeeds.length
          ? [activeComplaintIndex]
          : [];
    if (
      message.role === "patient" &&
      activeComplaintIndex < params.complaintSeeds.length &&
      !targetIndices.includes(activeComplaintIndex) &&
      looksLikeFollowUpAnswer(message.content)
    ) {
      targetIndices.push(activeComplaintIndex);
    }

    targetIndices.forEach((index) => {
      if (message.role === "assistant") {
        scopes[index].assistantQuestions.push(message.content.trim());
        if (index === activeComplaintIndex) {
          scopes[index].activeAssistantQuestions.push(message.content.trim());
        }
      } else {
        scopes[index].patientAnswers.push(message.content.trim());
      }
    });

    while (activeComplaintIndex < params.complaintSeeds.length) {
      const evaluation = evaluateComplaintScope({
        chiefComplaint: params.chiefComplaint,
        complaint: params.complaintSeeds[activeComplaintIndex].complaint,
        patientBackground: params.patientBackground,
        formSummary: params.formSummary,
        scope: scopes[activeComplaintIndex],
      });
      if (!evaluation.completed) {
        break;
      }
      activeComplaintIndex += 1;
    }
  });

  return { scopes, activeComplaintIndex };
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
  newComplaintCount: number;
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
  const hasMultiSystemSymptoms =
    params.newComplaintCount > 0 ||
    Boolean(
      `${text} ${answersText}`.match(
        /\b(chest pain.*shortness of breath|headache.*neurologic|abdominal pain.*vomit|multiple complaints|and also)\b/,
      ),
    );
  const hasChronicComplexity = Boolean(
    profileText.match(/\b(diabetes|copd|chf|heart failure|ckd|kidney disease|cancer|immunosupp|cirrhosis|anticoagulant|pregnan)\b/),
  );
  const hasStructuredFormUpload = formText.length > 0;
  const isTraumaOrMva = classifyComplaint(params.activeComplaint) === "Trauma";
  const reasons = [
    ...(hasRedFlagSignal ? ["red-flag-identified"] : []),
    ...(hasMultiSystemSymptoms ? ["multi-system-symptoms"] : []),
    ...(hasChronicComplexity ? ["chronic-complexity"] : []),
    ...(hasStructuredFormUpload ? ["structured-form-uploaded"] : []),
    ...(isTraumaOrMva ? ["trauma-mva"] : []),
    ...(params.newComplaintCount > 0 ? [`dynamic-complaints:${params.newComplaintCount}`] : []),
  ];

  return {
    active:
      hasRedFlagSignal ||
      hasMultiSystemSymptoms ||
      hasChronicComplexity ||
      hasStructuredFormUpload ||
      isTraumaOrMva,
    hasRedFlagSignal,
    hasMultiSystemSymptoms,
    hasChronicComplexity,
    hasStructuredFormUpload,
    isTraumaOrMva,
    reasons,
  };
}

function computeQuestionBudget(
  escalation: ReturnType<typeof detectEscalationState>,
  newComplaintCount: number,
) {
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
  if (newComplaintCount > 0) {
    budget += newComplaintCount * NEW_COMPLAINT_BUDGET_BONUS;
    modifiers.push(`+${newComplaintCount * NEW_COMPLAINT_BUDGET_BONUS}-new-complaint`);
  }
  return { budget, modifiers };
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

function buildComplaintProgress(params: {
  complaintSeed: ComplaintSeed;
  status: ComplaintStatus;
  scope: ComplaintScopeAccumulator;
  evaluation: EvaluatedComplaintScope;
}): ComplaintProgress {
  return {
    complaint: params.complaintSeed.complaint,
    complaintClass: params.evaluation.complaintClass,
    protocolId: params.evaluation.protocol.id,
    minQuestionCountTarget: params.evaluation.protocol.stopConditions.minQuestionCount,
    status: params.status,
    source: params.complaintSeed.source,
    addedMidInterview: params.complaintSeed.addedMidInterview,
    firstDetectedAtMessageIndex: params.complaintSeed.firstDetectedAtMessageIndex,
    questionCountSoFar: params.scope.assistantQuestions.length,
    activeQuestionCountSoFar: params.scope.activeAssistantQuestions.length,
    needsOpeningNarrative: params.scope.activeAssistantQuestions.length === 0,
    coveredTopics: Array.from(params.evaluation.coveredTopics),
    missingRequiredFieldKeys: params.evaluation.missingRequiredFields.map((item) => item.key),
    missingRedFlagKeys: params.evaluation.missingRedFlags.map((item) => item.key),
    missingVirtualExamKeys: params.evaluation.missingVirtualExamFields.map((item) => item.key),
    completed: params.evaluation.completed,
  };
}

function estimateComplaintRemainingQuestions(progress: ComplaintProgress): number {
  if (progress.completed) {
    return 0;
  }

  const minQuestionFloor = Math.max(
    progress.minQuestionCountTarget - progress.questionCountSoFar,
    0,
  );
  const unresolvedBucketEstimate =
    (progress.needsOpeningNarrative ? 1 : 0) +
    Math.ceil(progress.missingRequiredFieldKeys.length * 0.8) +
    Math.ceil(progress.missingRedFlagKeys.length / 3) +
    Math.ceil(progress.missingVirtualExamKeys.length * 0.75);

  return Math.max(minQuestionFloor, unresolvedBucketEstimate);
}

export function estimateInterviewProgress(state: {
  complaintQueue: ComplaintProgress[];
  activeComplaint: string;
  totalQuestionCount: number;
  remainingFormCoverageHints: string[];
  unresolvedClarification: string | null;
  questionBudget: number | null;
  summaryReady: boolean;
  shouldEarlyStop: boolean;
  forceSummary: boolean;
}): InterviewProgress {
  const baseAsked = state.totalQuestionCount;
  if (state.forceSummary || state.summaryReady || state.shouldEarlyStop) {
    return {
      questionsAsked: baseAsked,
      approxTotalQuestions: baseAsked,
    };
  }

  const complaintRemaining = state.complaintQueue.reduce(
    (total, complaint) => total + estimateComplaintRemainingQuestions(complaint),
    0,
  );
  const activeComplaint = state.complaintQueue.find(
    (complaint) => complaint.complaint === state.activeComplaint,
  );
  const formCoverageRemaining = Math.ceil(
    state.remainingFormCoverageHints.length * 0.75,
  );
  const clarificationBuffer = state.unresolvedClarification ? 1 : 0;
  const queueTransitionBuffer =
    state.complaintQueue.some(
      (complaint) =>
        complaint.status === "pending" &&
        complaint.questionCountSoFar === 0 &&
        complaint.needsOpeningNarrative,
    ) && activeComplaint && !activeComplaint.completed
      ? 1
      : 0;

  const approxTotalQuestions = Math.max(
    baseAsked,
    state.questionBudget ?? 0,
    baseAsked +
      complaintRemaining +
      formCoverageRemaining +
      clarificationBuffer +
      queueTransitionBuffer,
  );

  return {
    questionsAsked: baseAsked,
    approxTotalQuestions,
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

  const complaintSeeds = buildComplaintSeeds(params.chiefComplaint, params.transcript);
  const complaintScopes = buildComplaintScopes({
    chiefComplaint: params.chiefComplaint,
    complaintSeeds,
    transcript: params.transcript,
    patientBackground: params.patientBackground,
    formSummary: params.formSummary,
  });
  const allComplete = complaintScopes.activeComplaintIndex >= complaintSeeds.length;
  const safeActiveIndex = allComplete
    ? Math.max(complaintSeeds.length - 1, 0)
    : complaintScopes.activeComplaintIndex;
  const complaintQueue = complaintSeeds.map((seed, index) => {
    const status: ComplaintStatus = allComplete
      ? "completed"
      : index < complaintScopes.activeComplaintIndex
        ? "completed"
        : index === safeActiveIndex
          ? "active"
          : "pending";
    const evaluation = evaluateComplaintScope({
      chiefComplaint: params.chiefComplaint,
      complaint: seed.complaint,
      patientBackground: params.patientBackground,
      formSummary: params.formSummary,
      scope: complaintScopes.scopes[index],
    });
    return buildComplaintProgress({
      complaintSeed: seed,
      status,
      scope: complaintScopes.scopes[index],
      evaluation,
    });
  });

  const activeComplaintProgress = complaintQueue[safeActiveIndex];
  const activeScope = complaintScopes.scopes[safeActiveIndex] ?? {
    assistantQuestions: [],
    activeAssistantQuestions: [],
    patientAnswers: [],
  };
  const activeEvaluation = evaluateComplaintScope({
    chiefComplaint: params.chiefComplaint,
    complaint: activeComplaintProgress?.complaint ?? params.chiefComplaint,
    patientBackground: params.patientBackground,
    formSummary: params.formSummary,
    scope: activeScope,
  });
  const activeComplaint = activeComplaintProgress?.complaint ?? params.chiefComplaint;
  const newComplaintCount = complaintQueue.filter((item) => item.addedMidInterview).length;

  const escalation = detectEscalationState({
    chiefComplaint: params.chiefComplaint,
    activeComplaint,
    patientProfile: params.patientProfile,
    patientAnswers,
    formSummary: params.formSummary,
    newComplaintCount,
  });
  const budget = computeQuestionBudget(escalation, newComplaintCount);
  const phaseState = computeFormInterviewPhase({
    hasStructuredForm: escalation.hasStructuredFormUpload,
    questionCountSoFar: allQuestionsAsked.length,
    budget,
    escalation: {
      hasRedFlagSignal: escalation.hasRedFlagSignal,
      hasMultiSystemSymptoms: escalation.hasMultiSystemSymptoms,
      isTraumaOrMva: escalation.isTraumaOrMva,
    },
    hasMultipleComplaints: complaintQueue.length > 1,
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
      allComplete &&
      (!phaseState.hasStructuredForm || remainingFormCoverageHints.length === 0 || shouldEarlyStop));

  const interviewState: Omit<InterviewState, "progress"> = {
    chiefComplaint: params.chiefComplaint,
    complaints: complaintQueue.map((item) => item.complaint),
    pendingComplaints: complaintQueue
      .filter((item) => item.status === "pending")
      .map((item) => item.complaint),
    complaintQueue,
    activeComplaint,
    activeComplaintIndex: safeActiveIndex,
    completedComplaints: complaintQueue
      .filter((item) => item.status === "completed")
      .map((item) => item.complaint),
    complaintClass: activeEvaluation.complaintClass,
    visitStage: activeEvaluation.visitStage,
    protocol: activeEvaluation.protocol,
    complaintProgress: activeComplaintProgress,
    activeComplaintQuestionCount: activeScope.activeAssistantQuestions.length,
    activeComplaintQuestionsAsked: activeScope.activeAssistantQuestions,
    activePatientAnswers: activeScope.patientAnswers,
    activeCoveredTopics: Array.from(activeEvaluation.coveredTopics),
    activePatientFacts: activeEvaluation.patientFacts,
    questionCountSoFar: activeScope.activeAssistantQuestions.length,
    totalQuestionCount: allQuestionsAsked.length,
    allQuestionsAsked,
    patientAnswers,
    coveredTopics: Array.from(topicsCovered),
    patientFacts,
    missingRequiredFields: activeEvaluation.missingRequiredFields,
    missingRedFlags: activeEvaluation.missingRedFlags,
    missingVirtualExamFields: activeEvaluation.missingVirtualExamFields,
    remainingFormCoverageHints,
    urgency:
      escalation.hasRedFlagSignal || (activeEvaluation.missingRedFlags.length > 0 && allQuestionsAsked.length >= 4)
        ? "elevated"
        : "routine",
    questionBudget: budget.budget,
    questionBudgetModifiers: budget.modifiers,
    escalationReasons: escalation.reasons,
    newComplaintCount,
    shouldEarlyStop,
    summaryReady,
    unresolvedClarification,
    deferredIntentHint: params.deferredIntentHint,
    forceSummary: params.forceSummary,
  };

  return {
    ...interviewState,
    progress: estimateInterviewProgress(interviewState),
  };
}
