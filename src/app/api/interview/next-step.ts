import type { InterviewState, NextActionType, NextQuestionTarget, ProtocolCheck } from "./protocol-types";

export type NextInterviewStep = {
  action: NextActionType;
  target?: NextQuestionTarget;
  reason: string;
};

function toTarget(
  category: NextQuestionTarget["category"],
  check: ProtocolCheck,
  rationale: string,
): NextQuestionTarget {
  return {
    category,
    key: check.key,
    label: check.label,
    rationale,
    promptHint: check.promptHint,
  };
}

function makeSuppressedTargetSet(state: InterviewState) {
  return new Set(state.protocol.suppressedTargetsByStage?.[state.visitStage] ?? []);
}

function getFirstUnsuppressed(state: InterviewState, checks: ProtocolCheck[]) {
  const suppressed = makeSuppressedTargetSet(state);
  return checks.find((check) => !suppressed.has(check.key));
}

export function decideNextInterviewStep(state: InterviewState): NextInterviewStep {
  if (state.forceSummary) {
    return {
      action: "summarize",
      reason: "Patient requested summary.",
    };
  }

  if (state.unresolvedClarification) {
    return {
      action: "clarify",
      target: {
        category: "clarification",
        key: "clarify_last_response",
        label: "clarify unclear response",
        rationale: "Clarify the patient's last response before moving to a new topic.",
        promptHint: state.unresolvedClarification,
      },
      reason: "The last patient response is ambiguous.",
    };
  }

  if (state.questionCountSoFar === 0) {
    return {
      action: "ask_target",
      target: {
        category: "open_narrative",
        key: "open_narrative",
        label: "open narrative",
        rationale: "Start with an open-ended, complaint-focused narrative question.",
        promptHint: "Rephrase the chief complaint naturally and invite the patient to tell their story.",
      },
      reason: "First turn should gather the patient narrative.",
    };
  }

  if (state.deferredIntentHint) {
    return {
      action: "ask_target",
      target: {
        category: "required_field",
        key: "deferred_intent",
        label: "deferred clinical intent",
        rationale: "Cover the deferred clinical intent after the forced location question.",
        promptHint: state.deferredIntentHint,
      },
      reason: "Resume the deferred topic after location capture.",
    };
  }

  const nextRequired = getFirstUnsuppressed(state, state.missingRequiredFields);
  if (nextRequired) {
    const category =
      state.visitStage === "initial" ? "required_field" : nextRequired.key.includes("work") || nextRequired.key.includes("rehab") || nextRequired.key.includes("interval")
        ? "follow_up"
        : "required_field";
    return {
      action: "ask_target",
      target: toTarget(
        category,
        nextRequired,
        "Ask about the highest-priority missing required field for the active complaint.",
      ),
      reason: "Required history is still missing.",
    };
  }

  const nextRedFlag = getFirstUnsuppressed(state, state.missingRedFlags);
  if (nextRedFlag) {
    return {
      action: "ask_target",
      target: toTarget("red_flag", nextRedFlag, "Rule out the next complaint-specific red flag."),
      reason: "Red-flag assessment is incomplete.",
    };
  }

  const nextVirtualExam = getFirstUnsuppressed(state, state.missingVirtualExamFields);
  if (nextVirtualExam) {
    return {
      action: "ask_target",
      target: toTarget(
        "virtual_exam",
        nextVirtualExam,
        "Complete the remaining virtual exam field relevant to the active complaint.",
      ),
      reason: "Virtual exam coverage is incomplete.",
    };
  }

  const nextFormHint = state.remainingFormCoverageHints[0];
  if (nextFormHint) {
    return {
      action: "ask_target",
      target: {
        category: "form",
        key: "form_completion",
        label: "form completion item",
        rationale: "Gather a remaining physician-form item before summarizing.",
        promptHint: nextFormHint,
      },
      reason: "Structured form coverage is incomplete.",
    };
  }

  if (state.summaryReady || state.shouldEarlyStop) {
    return {
      action: "summarize",
      reason: state.summaryReady
        ? "Required information is complete."
        : "Early-stop condition was reached without high-priority gaps.",
    };
  }

  return {
    action: "summarize",
    reason: "No safe next target remained after controller evaluation.",
  };
}
