import type { InterviewResponse } from "@/lib/interview-schema";

type InterviewPhase = "hpi_phase" | "form_phase";

type FormInterviewPhaseState = {
  hasStructuredForm: boolean;
  questionCountSoFar: number;
  targetQuestionCount: number;
  secondHalfStart: number;
  phase: InterviewPhase;
};

type FormCoverageHint = {
  label: string;
  patterns: RegExp[];
  topicHints?: string[];
};

export type SensitivePhotoContext = {
  suppressPhotoRequest: boolean;
  reason: string | null;
  matchedScope: "female_breast" | "genital_private" | null;
};

type EscalationStateLike = {
  hasRedFlagSignal: boolean;
  hasMultiSystemSymptoms: boolean;
  isTraumaOrMva: boolean;
};

const BASE_QUESTION_BUDGET = 10;

const FORM_COVERAGE_HINTS: FormCoverageHint[] = [
  {
    label: "symptom onset and timeline",
    patterns: [/\bonset\b/, /\bwhen\b/, /\bstart(?:ed)?\b/, /\bduration\b/, /\btimeline\b/],
    topicHints: ["duration/onset"],
  },
  {
    label: "symptom severity and functional impact",
    patterns: [/\bseverity\b/, /\bhow bad\b/, /\bscale\b/, /\bfunctional\b/, /\blimit(?:ed|ation)\b/],
    topicHints: ["severity", "range of motion"],
  },
  {
    label: "work and activity limitations",
    patterns: [/\bwork\b/, /\bdut(?:y|ies)\b/, /\bactivity\b/, /\brestriction\b/, /\bmodified duty\b/],
  },
  {
    label: "accident details and mechanism",
    patterns: [/\baccident\b/, /\bmva\b/, /\bmotor vehicle\b/, /\bcollision\b/, /\bmechanism\b/],
    topicHints: ["accident details", "accident response"],
  },
  {
    label: "previous injuries and baseline status",
    patterns: [/\bprevious injur(?:y|ies)\b/, /\bprior injur(?:y|ies)\b/, /\bpre[- ]?existing\b/, /\bbaseline\b/],
    topicHints: ["previous injuries"],
  },
  {
    label: "medications and allergies relevant to the form",
    patterns: [/\bmedication\b/, /\bcurrent meds?\b/, /\ballerg(?:y|ies)\b/, /\bdrug reaction\b/],
  },
  {
    label: "insurance/employer/claim details",
    patterns: [/\binsurance\b/, /\bclaim\b/, /\bemployer\b/, /\bworksafe\b/, /\bwsib\b/],
  },
  {
    label: "treating provider and follow-up details",
    patterns: [/\bfamily doctor\b/, /\bphysician\b/, /\bprovider\b/, /\bfollow[- ]?up\b/, /\breferral\b/],
  },
];

export function computeFormInterviewPhase(params: {
  hasStructuredForm: boolean;
  questionCountSoFar: number;
  budget: { budget: number | null; modifiers: string[] };
  escalation: EscalationStateLike;
  hasMultipleComplaints: boolean;
}): FormInterviewPhaseState {
  const { hasStructuredForm, questionCountSoFar, budget, escalation, hasMultipleComplaints } = params;
  let targetQuestionCount =
    budget.budget ??
    BASE_QUESTION_BUDGET +
      (hasMultipleComplaints ? 4 : 0) +
      (escalation.hasRedFlagSignal ? 3 : 0) +
      (escalation.hasMultiSystemSymptoms ? 3 : 0) +
      (escalation.isTraumaOrMva ? 4 : 0);

  if (hasStructuredForm) {
    targetQuestionCount = Math.max(targetQuestionCount, hasMultipleComplaints ? 18 : 14);
  } else {
    targetQuestionCount = Math.max(targetQuestionCount, hasMultipleComplaints ? 12 : 8);
  }

  const secondHalfStart = Math.max(4, Math.ceil(targetQuestionCount / 2));
  const phase: InterviewPhase =
    hasStructuredForm && questionCountSoFar >= secondHalfStart ? "form_phase" : "hpi_phase";

  return {
    hasStructuredForm,
    questionCountSoFar,
    targetQuestionCount,
    secondHalfStart,
    phase,
  };
}

export function getFormCoverageHints(formSummary: string | null): FormCoverageHint[] {
  if (!formSummary || formSummary.trim().length === 0) {
    return [];
  }
  const text = formSummary.toLowerCase();
  return FORM_COVERAGE_HINTS.filter((hint) => hint.patterns.some((pattern) => pattern.test(text)));
}

export function getRemainingFormCoverageHints(params: {
  formHints: FormCoverageHint[];
  allQuestionsAsked: string[];
  patientAnswers: string[];
  topicsCovered: Set<string>;
  patientMentionedTopics: string[];
}): string[] {
  if (params.formHints.length === 0) {
    return [];
  }
  const askedAndAnsweredText = `${params.allQuestionsAsked.join(" ")} ${params.patientAnswers.join(" ")}`.toLowerCase();
  const coveredTopics = new Set([...params.topicsCovered, ...params.patientMentionedTopics]);

  return params.formHints
    .filter((hint) => {
      const coveredByText = hint.patterns.some((pattern) => pattern.test(askedAndAnsweredText));
      const coveredByTopic = hint.topicHints?.some((topic) => coveredTopics.has(topic)) ?? false;
      return !(coveredByText || coveredByTopic);
    })
    .map((hint) => hint.label);
}

const MVA_PATTERN =
  /\b(mva|motor vehicle accident|motor vehicle collision|motor vehicle crash|car accident|mvc)\b/i;
const FOLLOW_UP_PATTERN =
  /\b(follow[- ]?up|followup|reassessment|recheck|ongoing|persistent|still bothering|still having|not fully better|not fully resolved)\b/i;
const INTERVAL_PATTERN =
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:day|days|week|weeks|month|months|year|years)\b/i;
const REHAB_PATTERN =
  /\b(physio|physiotherapy|chiro|chiropract|massage therapy|rehab|therapy|home exercises?|exercise program)\b/i;
const PAIN_CONTROL_PATTERN =
  /\b(tylenol|acetaminophen|advil|ibuprofen|naproxen|pain medication|pain medicine|muscle relax|pain control)\b/i;
const RECOVERY_PATTERN =
  /\b(improv(?:e|ing|ed|ement)|wors(?:e|ening|ened)|same|unchanged|persistent|still)\b/i;

export function isLikelyMvaFollowUpContext(params: {
  chiefComplaint: string;
  patientBackground: string | null;
  formSummary: string | null;
  patientAnswers: string[];
}): boolean {
  const contextText = [
    params.chiefComplaint,
    params.patientBackground ?? "",
    params.formSummary ?? "",
    ...params.patientAnswers,
  ]
    .join(" ")
    .toLowerCase();

  const hasMvaContext = MVA_PATTERN.test(contextText);
  if (!hasMvaContext) {
    return false;
  }

  const hasExplicitFollowUp = FOLLOW_UP_PATTERN.test(contextText);
  const hasIntervalRecoveryContext =
    INTERVAL_PATTERN.test(contextText) && (REHAB_PATTERN.test(contextText) || PAIN_CONTROL_PATTERN.test(contextText));
  const hasIntervalStatusContext = INTERVAL_PATTERN.test(contextText) && RECOVERY_PATTERN.test(contextText);

  return hasExplicitFollowUp || hasIntervalRecoveryContext || hasIntervalStatusContext;
}

export function getMvaFollowUpPromptSection(params: {
  chiefComplaint: string;
  patientBackground: string | null;
  formSummary: string | null;
  patientAnswers: string[];
}): string {
  if (!isLikelyMvaFollowUpContext(params)) {
    return "";
  }

  return `

MVA FOLLOW-UP MODE (LIKELY ESTABLISHED ACCIDENT CASE):
- Context suggests this is a later follow-up rather than the first post-accident visit.
- Start with a broad, open-ended follow-up question and let the patient direct the interview toward the symptoms or body areas that still matter most.
- Good follow-up openings include: "How have you been doing since the accident?" or "What symptoms are still bothering you most now?"
- Do NOT turn this into a rigid checklist if the patient is already giving a clear narrative.
- Do NOT automatically repeat first-visit/admin questions such as accident date, insurance claim number, passengers, vehicle type, vehicle damage, seatbelt/airbag, ambulance/ER, or prior injury history unless that information is truly missing and clinically necessary now.
- Do NOT automatically ask a broad acute-trauma red-flag bundle months later just because the complaint mentions an accident. Ask targeted safety questions only if the patient's CURRENT symptoms make them clinically relevant.
- Prioritize interval history: whether symptoms are improving, worsening, or unchanged; which body areas have improved versus remain symptomatic; current pain/function; rehab or therapy attendance and frequency; current pain-control medications and how often they are used.
- Ask about recent re-evaluation, imaging, or new investigations only if it is relevant to the patient's current course or would change physician handoff.
`;
}

export function getMvaAdminPromptSection(chiefComplaint: string): string {
  if (!MVA_PATTERN.test(chiefComplaint)) {
    return "";
  }

  return `

MVA HISTORY (WHEN INITIAL VISIT):
- When clinically appropriate and this is the initial MVA visit (not follow up) include in your history gathering: name of car insurance company, claim number, and exact date of the accident. Integrate these naturally; do not turn them into a rigid checklist.
`;
}

const PHOTO_REQUEST_PHRASES = [
  "upload a photo",
  "share a photo",
  "send a photo",
  "take a photo",
  "upload a picture",
  "share a picture",
  "send a picture",
  "take a picture",
  "upload an image",
  "share an image",
  "send an image",
  "photo would be helpful",
  "picture would be helpful",
  "image would be helpful",
  "can you upload",
  "would you like to upload",
];

const PRIVATE_AREA_PATTERN =
  /\b(genital|genitals|groin|penis|penile|scrotum|scrotal|testicle|testicles|testis|vagina|vaginal|vulva|vulvar|labia|perineum|perineal|private area|private part|intimate area|intimate part)\b/i;
const FEMALE_BREAST_ANATOMY_PATTERN = /\b(breast|breasts|nipple|areola)\b/i;
const FEMALE_BREAST_SENSITIVE_CONDITION_PATTERN =
  /\b(rash|lesion|lump|mass|discharge|ulcer|wound|bump|mole|spot|skin change|skin changes)\b/i;

export function isPhotoUploadRequestText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    PHOTO_REQUEST_PHRASES.some((phrase) => lower.includes(phrase)) ||
    (/\b(upload|share|send|take)\b/.test(lower) && /\b(photo|picture|image)\b/.test(lower))
  );
}

export function getSensitivePhotoContext(params: {
  sex?: string | null;
  textBlocks: string[];
}): SensitivePhotoContext {
  const combined = params.textBlocks.join(" ").toLowerCase();
  const normalizedSex = (params.sex || "").toLowerCase();

  if (PRIVATE_AREA_PATTERN.test(combined)) {
    return {
      suppressPhotoRequest: true,
      reason: "private-genital-area",
      matchedScope: "genital_private",
    };
  }

  if (
    normalizedSex === "female" &&
    FEMALE_BREAST_ANATOMY_PATTERN.test(combined) &&
    FEMALE_BREAST_SENSITIVE_CONDITION_PATTERN.test(combined)
  ) {
    return {
      suppressPhotoRequest: true,
      reason: "female-breast-sensitive-condition",
      matchedScope: "female_breast",
    };
  }

  return {
    suppressPhotoRequest: false,
    reason: null,
    matchedScope: null,
  };
}

export function applySensitivePhotoSuppressionToTurn(
  turn: InterviewResponse,
  context: SensitivePhotoContext,
): InterviewResponse {
  if (!context.suppressPhotoRequest || turn.type !== "question") {
    return turn;
  }

  const isPhotoRequest = turn.requiresPhotoUpload === true || isPhotoUploadRequestText(turn.question);
  if (!isPhotoRequest) {
    return turn;
  }

  return {
    ...turn,
    question:
      "Please describe the affected area in words, including exact location, appearance changes, tenderness, discharge, itch, or progression over time.",
    rationale:
      "Sensitive-area safety policy: collect text-only clinical details without requesting photo upload.",
    requiresPhotoUpload: false,
  };
}
