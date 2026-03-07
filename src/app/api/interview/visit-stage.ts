import { isLikelyMvaFollowUpContext } from "./prompt-helpers";
import type { VisitStage } from "./protocol-types";

const FOLLOW_UP_PATTERN =
  /\b(follow[- ]?up|followup|reassessment|recheck|ongoing|persistent|still bothering|still having|not fully better|not fully resolved)\b/i;
const LATE_INTERVAL_PATTERN =
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:week|weeks|month|months|year|years)\b/i;
const DOCUMENTATION_PATTERN =
  /\b(form|claim|insurance|wsib|worksafe|disability|legal|lawyer|report|documentation)\b/i;
const REHAB_PATTERN =
  /\b(physio|physiotherapy|chiro|chiropract|massage therapy|rehab|therapy|home exercises?|exercise program)\b/i;
const RECOVERY_PATTERN =
  /\b(improv(?:e|ing|ed|ement)|wors(?:e|ening|ened)|same|unchanged|persistent|still)\b/i;

export function classifyVisitStage(params: {
  chiefComplaint: string;
  activeComplaint: string;
  patientBackground: string | null;
  formSummary: string | null;
  patientAnswers: string[];
}): VisitStage {
  const combined = [
    params.chiefComplaint,
    params.activeComplaint,
    params.patientBackground ?? "",
    params.formSummary ?? "",
    ...params.patientAnswers,
  ].join(" ");

  const lower = combined.toLowerCase();
  const hasDocumentation = DOCUMENTATION_PATTERN.test(lower);
  const hasFollowUpSignal =
    FOLLOW_UP_PATTERN.test(lower) ||
    isLikelyMvaFollowUpContext({
      chiefComplaint: params.chiefComplaint,
      patientBackground: params.patientBackground,
      formSummary: params.formSummary,
      patientAnswers: params.patientAnswers,
    });

  if (!hasFollowUpSignal) {
    return "initial";
  }

  const hasLateSignal =
    LATE_INTERVAL_PATTERN.test(lower) || (REHAB_PATTERN.test(lower) && RECOVERY_PATTERN.test(lower));

  if (hasDocumentation) {
    return "documentation_follow_up";
  }

  if (hasLateSignal) {
    return "late_follow_up";
  }

  return "early_follow_up";
}
