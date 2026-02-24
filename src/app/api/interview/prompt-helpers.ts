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
