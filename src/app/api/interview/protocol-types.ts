export type ComplaintClass =
  | "MSK"
  | "Neuro"
  | "Cardio"
  | "GI"
  | "Respiratory"
  | "Trauma"
  | "Dermatology"
  | "General";

export type VisitStage =
  | "initial"
  | "early_follow_up"
  | "late_follow_up"
  | "documentation_follow_up";

export type NextActionType = "clarify" | "ask_target" | "escalate" | "summarize";

export type NextQuestionTargetCategory =
  | "open_narrative"
  | "required_field"
  | "red_flag"
  | "virtual_exam"
  | "follow_up"
  | "form"
  | "clarification";

export type ProtocolTopicKey =
  | "duration/onset"
  | "location"
  | "severity"
  | "quality"
  | "triggers"
  | "relieving factors"
  | "associated symptoms"
  | "range of motion"
  | "tenderness"
  | "swelling"
  | "redness"
  | "exudate"
  | "constitutional symptoms"
  | "respiratory"
  | "cardiac symptoms"
  | "neurological"
  | "loss of consciousness"
  | "accident details"
  | "accident response"
  | "previous injuries"
  | "current symptoms"
  | "interval change"
  | "function impact"
  | "work status"
  | "rehab progress"
  | "current red flags";

export type ProtocolCheck = {
  key: string;
  label: string;
  coverageTopics: ProtocolTopicKey[];
  promptHint?: string;
};

export type ComplaintProtocol = {
  id: string;
  complaintClass: ComplaintClass;
  requiredFields: ProtocolCheck[];
  redFlags: ProtocolCheck[];
  virtualExamFields: ProtocolCheck[];
  photoAppropriate: boolean;
  stopConditions: {
    minQuestionCount: number;
    requireRedFlags: boolean;
    requireRequiredFields: boolean;
    requireVirtualExamWhenApplicable: boolean;
  };
  suppressedTargetsByStage?: Partial<Record<VisitStage, string[]>>;
};

export type NextQuestionTarget = {
  category: NextQuestionTargetCategory;
  key: string;
  label: string;
  rationale: string;
  promptHint?: string;
};

export type InterviewFactSummary = {
  mentionedTopics: ProtocolTopicKey[];
  symptomDetails: string[];
  redFlagsMentioned: string[];
  informationSummary: string;
};

export type ComplaintProgress = {
  complaint: string;
  complaintClass: ComplaintClass;
  protocolId: string;
  coveredTopics: ProtocolTopicKey[];
  missingRequiredFieldKeys: string[];
  missingRedFlagKeys: string[];
  missingVirtualExamKeys: string[];
  completed: boolean;
};

export type InterviewState = {
  chiefComplaint: string;
  complaints: string[];
  activeComplaint: string;
  activeComplaintIndex: number;
  completedComplaints: string[];
  complaintClass: ComplaintClass;
  visitStage: VisitStage;
  protocol: ComplaintProtocol;
  complaintProgress: ComplaintProgress;
  questionCountSoFar: number;
  allQuestionsAsked: string[];
  patientAnswers: string[];
  coveredTopics: ProtocolTopicKey[];
  patientFacts: InterviewFactSummary;
  missingRequiredFields: ProtocolCheck[];
  missingRedFlags: ProtocolCheck[];
  missingVirtualExamFields: ProtocolCheck[];
  remainingFormCoverageHints: string[];
  urgency: "routine" | "elevated";
  shouldEarlyStop: boolean;
  summaryReady: boolean;
  unresolvedClarification: string | null;
  deferredIntentHint: string | null;
  forceSummary: boolean;
};
