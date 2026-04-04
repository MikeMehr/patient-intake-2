import type { InterviewProgress } from "@/lib/interview-schema";
import type { BodyPart } from "@/lib/body-parts";

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
  | "uri symptoms"
  | "infectious context"
  | "throat red flags"
  | "range of motion"
  | "tenderness"
  | "swelling"
  | "redness"
  | "exudate"
  | "constitutional symptoms"
  | "bowel symptoms"
  | "urinary symptoms"
  | "pregnancy context"
  | "abdominal red flags"
  | "respiratory"
  | "cardiac symptoms"
  | "neurological"
  | "loss of consciousness"
  | "diabetes treatment"
  | "glucose control"
  | "diabetes red flags"
  | "diabetes hypoglycemia"
  | "diabetes hyperglycemia"
  | "diabetes neuropathy"
  | "diabetes vision"
  | "diabetes chest/sob"
  | "diabetes sores/infections"
  | "diabetes fatigue"
  | "diabetes weight change"
  | "diabetes sexual function"
  | "diabetes gi symptoms"
  | "diabetes urinary symptoms"
  | "medication refill need"
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
  handoffNeeds: string[];
};

export type ComplaintStatus = "active" | "pending" | "completed";

export type ComplaintSource = "chief_complaint" | "transcript";

export type BriefSecondaryConcern = {
  complaint: string;
  firstDetectedAtMessageIndex: number | null;
};

export type ComplaintProgress = {
  complaint: string;
  originalComplaint: string;
  complaintClass: ComplaintClass;
  protocolId: string;
  minQuestionCountTarget: number;
  status: ComplaintStatus;
  source: ComplaintSource;
  addedMidInterview: boolean;
  firstDetectedAtMessageIndex: number | null;
  questionCountSoFar: number;
  activeQuestionCountSoFar: number;
  needsOpeningNarrative: boolean;
  coveredTopics: ProtocolTopicKey[];
  missingRequiredFieldKeys: string[];
  missingRedFlagKeys: string[];
  missingVirtualExamKeys: string[];
  completed: boolean;
};

export type InterviewState = {
  chiefComplaint: string;
  complaints: string[];
  pendingComplaints: string[];
  briefSecondaryConcerns: BriefSecondaryConcern[];
  complaintQueue: ComplaintProgress[];
  activeComplaint: string;
  activeComplaintIndex: number;
  completedComplaints: string[];
  complaintClass: ComplaintClass;
  visitStage: VisitStage;
  protocol: ComplaintProtocol;
  complaintProgress: ComplaintProgress;
  activeComplaintQuestionCount: number;
  activeComplaintQuestionsAsked: string[];
  activePatientAnswers: string[];
  activeCoveredTopics: ProtocolTopicKey[];
  activePatientFacts: InterviewFactSummary;
  activeHandoffNeeds: string[];
  questionCountSoFar: number;
  totalQuestionCount: number;
  allQuestionsAsked: string[];
  patientAnswers: string[];
  coveredTopics: ProtocolTopicKey[];
  patientFacts: InterviewFactSummary;
  handoffNeeds: string[];
  missingRequiredFields: ProtocolCheck[];
  missingRedFlags: ProtocolCheck[];
  missingVirtualExamFields: ProtocolCheck[];
  remainingFormCoverageHints: string[];
  urgency: "routine" | "elevated";
  questionBudget: number | null;
  questionBudgetModifiers: string[];
  escalationReasons: string[];
  newComplaintCount: number;
  shouldEarlyStop: boolean;
  summaryReady: boolean;
  historyConfidence: "clear" | "needs_clarification" | "unsafe_to_continue";
  clarificationAttemptCount: number;
  shouldEndEarlyForUnclearHistory: boolean;
  repeatedPendingConcernRedirectCount: number;
  shouldSummarizeAfterRepeatedRedirection: boolean;
  earlyStopReason: string | null;
  unresolvedClarification: string | null;
  complaintClarificationHint: string | null;
  deferredIntentHint: string | null;
  forceSummary: boolean;
  completedDiagramParts: BodyPart[];
  progress: InterviewProgress;
};
