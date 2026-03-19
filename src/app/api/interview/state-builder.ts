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
import {
  classifyComplaint,
  getComplaintProtocol,
  normalizeComplaintText,
  resolveComplaintRouting,
} from "./complaint-protocols";
import type { ComplaintSource, ComplaintStatus } from "./protocol-types";
import {
  type BriefSecondaryConcern,
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
  /\b(regarding|worried about|concerned about|questions? about|what should i do(?: next)? about|what do i do about|help with|guidance about|asking about|follow[- ]?up(?: visit)? (?:for|regarding|about|on)|following up on|checking on|review(?:ing)? (?:my|the)?|go(?:ing)? over)\b/;
const SYMPTOM_CONTEXT_PATTERN =
  /\b(pain|painful|hurt|hurts|hurting|ache|aching|swelling|swollen|lump|rash|lesion|wound|ulcer|numb|tingling|weakness|stiff|stiffness|cough|shortness of breath|dyspnea|headache|discharge|sore throat|fever|abdomen|abdominal|nausea|vomit)\b/;
const MARKER_ONLY_PATTERN =
  /\b(marked|mark|clicked|tapped|placed an x|placed x|diagram|photo|image)\b/;
const RESULT_FOLLOW_UP_PATTERN =
  /\b(ultrasound|u\/s|scan|imaging|ct|mri|x-?ray|report|results?|show(?:ed|ing)?|found|revealed|fatty liver)\b/;
const MEDICAL_CONCERN_KEYWORD_PATTERN =
  /\b(prediabet(?:es|ic)?|diabet(?:es|ic)?|dm2|t2dm|blood sugar|glucose|a1c|hba1c|cholesterol|lipid|triglyceride|blood pressure|hypertension|thyroid|kidney|renal|liver|hepat|anemia|iron|vitamin d|vitamin b12|test result|lab result|labs?)\b/;
const CONCERN_EXTRACT_PATTERNS = [
  /\b(?:also\s+)?regarding\s+([^.!?\n]+)/i,
  /\b(?:i am|i'm|im)?\s*(?:also\s+)?worried about\s+([^.!?\n]+)/i,
  /\b(?:i am|i'm|im)?\s*(?:also\s+)?concerned about\s+([^.!?\n]+)/i,
  /\bquestions?\s+about\s+([^.!?\n]+)/i,
  /\bwhat should i do(?: next)? about\s+([^.!?\n]+)/i,
  /\bwhat do i do about\s+([^.!?\n]+)/i,
  /\bhelp with\s+([^.!?\n]+)/i,
  /\bguidance about\s+([^.!?\n]+)/i,
  /\bfollow[- ]?up(?: visit)?\s+(?:for|regarding|about|on)\s+([^.!?\n]+)/i,
  /\bfollowing up on\s+([^.!?\n]+)/i,
  /\bchecking on\s+([^.!?\n]+)/i,
  /\breview(?:ing)?\s+(?:my|the)?\s*([^.!?\n]+(?:results?|report|ultrasound|scan)[^.!?\n]*)/i,
  /\bgo(?:ing)? over\s+([^.!?\n]+)/i,
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
  { pattern: /\b(cough|coughing)\b/, label: "cough" },
  { pattern: /\bsore throat\b/, label: "sore throat" },
  { pattern: /\bheadache|migraine\b/, label: "headache" },
  { pattern: /\babdominal pain|stomach pain\b/, label: "abdominal pain" },
  { pattern: /\brash|skin lesion|skin wound|hives\b/, label: "rash" },
];
const CONDITION_LAB_DYNAMIC_COMPLAINTS = [
  {
    pattern:
      /\b(prediabet(?:es|ic)?|diabet(?:es|ic)?|dm2|t2dm|blood sugar|glucose|a1c|hba1c|sugar management)\b/,
    label: "blood sugar concern",
  },
  { pattern: /\b(blood pressure|hypertension)\b/, label: "blood pressure concern" },
  { pattern: /\b(cholesterol|lipid|triglyceride)\b/, label: "cholesterol concern" },
  { pattern: /\b(thyroid|tsh)\b/, label: "thyroid concern" },
  { pattern: /\b(kidney|renal|creatinine|egfr)\b/, label: "kidney function concern" },
  { pattern: /\b(liver|hepatic|alt|ast)\b/, label: "liver function concern" },
  { pattern: /\b(anemia|iron|ferritin|hemoglobin)\b/, label: "anemia or iron concern" },
];
const RESOLVED_SECONDARY_COMPLAINT_PATTERN =
  /\b(resolved|completely resolved|gone|gone away|went away|better now|much better|improv(?:ed|ing)|pretty much gone|no longer|not anymore|back to normal|not really a concern|not a concern|not an issue|nothing unusual)\b/;
const HISTORICAL_SECONDARY_COMPLAINT_PATTERN =
  /\b(had|had a|experienced|was having|came on|occurred|during|while|at that time|back then|earlier)\b/;
const ACTIVE_SECONDARY_COMPLAINT_PATTERN =
  /\b(still|ongoing|current|currently|now|worsening|getting worse|persistent|recurring|again|keeps happening|continu(?:e|es|ing)|has not resolved|hasn't resolved|not improving)\b/;
const URGENT_SECONDARY_COMPLAINT_PATTERN =
  /\b(severe|worst|thunderclap|vision changes?|blurry vision|double vision|weakness|numbness|trouble speaking|confusion|faint(?:ed|ing)?|passed out|loss of consciousness|stiff neck|persistent vomiting|can't keep fluids down|shortness of breath|chest pain|vomiting blood|blood in (?:the )?stool|black stools?)\b/;
const PROMOTE_BRIEF_CONCERN_PATTERN =
  /\b(yes|yeah|yep|still|ongoing|current|currently|returned|back again|recurring|worse|worsening|severe|worst|\d+\/10|vision changes?|blurry vision|double vision|weakness|numbness|trouble speaking|confusion|faint(?:ed|ing)?|passed out|loss of consciousness|stiff neck|persistent vomiting|can't keep fluids down|shortness of breath|chest pain|blood)\b/;
const REASSURING_BRIEF_CONCERN_PATTERN =
  /\b(no|none|resolved|completely resolved|gone|gone away|better|improving|no longer|not anymore|nothing unusual|not really a concern)\b/;
const EXPLICIT_CORRECTION_PATTERN =
  /\b(i did(?: not|n't) mention|i did(?: not|n't) say|that's not what i said|that is not what i said|i never mentioned|i wasn't talking about|i was not talking about|you misunderstood|you heard me wrong)\b/;
const COMPLAINT_DENIAL_PATTERN = /\b(no|not|none|never|without)\b/;
const CLARIFICATION_REQUEST_PATTERN =
  /\b(could you clarify|can you clarify|help me understand|make sure i understand|i(?: am|'m) not sure i understand|did you mean|what do you mean|may not be understanding|misunderstood)\b/;
const PENDING_CONCERN_REDIRECT_PATTERN =
  /\b(can we talk about|talk about|i(?: am|'m)? just asking about|asking about|what about|i want to discuss|i want to talk about|come back to|focus on)\b/;
const DISTINCT_COUGH_PATTERN =
  /\b((?:separate|distinct)(?:\s+\w+){0,2}\s+cough|persistent cough|lingering cough|cough(?:\s+\w+){0,4}\s+for\s+\d|cough(?:\s+\w+){0,4}\s+wheez|cough(?:\s+\w+){0,4}\s+shortness of breath|cough(?:\s+\w+){0,4}\s+chest tightness|coughing fits)\b/;
const MEDICATION_REFILL_PATTERN =
  /\b(running out of|run out of|almost out of|running low on|need(?:ing)? (?:a )?refill|refill(?: for)?|renew(?:al)?(?: of)?|need more)\b/;
const SPELLED_DURATION_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
const MONTH_YEAR_PATTERN =
  /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+\d{4}\b/i;
const SEASON_YEAR_PATTERN = /\b(spring|summer|fall|autumn|winter)\s+\d{4}\b/i;
const DIAGNOSED_YEAR_PATTERN =
  /\b(diagnosed|diagnosis|managing(?: since)?|since)\b(?:\s+\w+){0,6}\s+\b\d{4}\b/i;

type ComplaintSeed = {
  complaint: string;
  originalComplaint: string;
  source: ComplaintSource;
  addedMidInterview: boolean;
  firstDetectedAtMessageIndex: number | null;
};

type DynamicComplaintDisposition = "full_workup" | "brief_safety_screen";

type DynamicComplaintDetection = {
  complaint: string;
  disposition: DynamicComplaintDisposition;
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
  complaintClarificationHint: string | null;
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
  if (
    qLower.match(
      /\b(cough|congestion|runny nose|rhinorrhea|sinus|cold symptoms|upper respiratory|uri)\b/,
    )
  ) {
    topics.push("uri symptoms");
  }
  if (
    qLower.match(
      /\b(sick contacts?|strep exposure|exposure to strep|similar illness|white spots|exudate|tonsil swelling|swollen tonsils)\b/,
    )
  ) {
    topics.push("infectious context");
  }
  if (
    qLower.match(
      /\b(trouble swallowing|difficulty swallowing|swallow liquids|drooling|muffled voice|neck swelling|stridor|can(?:'|’)t swallow)\b/,
    )
  ) {
    topics.push("throat red flags");
  }
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
  if (
    qLower.match(
      /\b(nausea|vomit|vomiting|diarrhea|constipation|bowel|stool|appetite|bloody stool|black stool|melena)\b/,
    )
  ) {
    topics.push("bowel symptoms");
  }
  if (qLower.match(/\b(urinary|urine|pee|burning|dysuria|frequency|urgency|hematuria)\b/)) {
    topics.push("urinary symptoms");
  }
  if (qLower.match(/\b(pregnan|lmp|last menstrual|period|missed period)\b/)) {
    topics.push("pregnancy context");
  }
  if (
    qLower.match(
      /\b(vomiting blood|blood in stool|black stool|melena|hematemesis|faint|syncope|passed out|jaundice|yellow|can(?:'|’)t keep fluids down|unable to keep fluids down|persistent vomiting|rapidly worsening pain)\b/,
    )
  ) {
    topics.push("abdominal red flags");
  }
  if (
    qLower.match(/\b(metformin|insulin|medication|medications|dose|adherence|taking|miss doses)\b/)
  ) {
    topics.push("diabetes treatment");
  }
  if (qLower.match(/\b(running out|run out|refill|renewal|running low)\b/)) {
    topics.push("medication refill need");
  }
  if (
    qLower.match(
      /\b(a1c|hba1c|glucose|blood sugar|home readings|fasting|postprandial|post-prandial|finger-?stick|cgm)\b/,
    )
  ) {
    topics.push("glucose control");
  }
  if (qLower.match(/\b(low blood sugar|hypoglyc|shaky|sweaty|sweating|dizziness|feeling faint)\b/)) {
    topics.push("diabetes hypoglycemia");
  }
  if (
    qLower.match(
      /\b(high blood sugar|hyperglyc|increased thirst|thirsty|frequent urination|urinating more|polyuria|polydipsia|increased hunger)\b/,
    )
  ) {
    topics.push("diabetes hyperglycemia");
  }
  if (qLower.match(/\b(numbness|tingling|burning|loss of sensation|neuropathy)\b/)) {
    topics.push("diabetes neuropathy");
  }
  if (qLower.match(/\b(vision|blurry vision|blurred vision|seeing|glasses)\b/)) {
    topics.push("diabetes vision");
  }
  if (qLower.match(/\b(chest pain|shortness of breath|leg swelling|ankle swelling)\b/)) {
    topics.push("diabetes chest/sob");
  }
  if (qLower.match(/\b(sores|cuts|ulcer|wound|slow healing|infection|infections)\b/)) {
    topics.push("diabetes sores/infections");
  }
  if (qLower.match(/\b(fatigue|tired|low energy)\b/)) {
    topics.push("diabetes fatigue");
  }
  if (qLower.match(/\b(weight loss|weight gain|unintended weight)\b/)) {
    topics.push("diabetes weight change");
  }
  if (qLower.match(/\b(sexual function|erection|erections|libido)\b/)) {
    topics.push("diabetes sexual function");
  }
  if (qLower.match(/\b(nausea|vomiting|bloating|full very quickly|stomach)\b/)) {
    topics.push("diabetes gi symptoms");
  }
  if (qLower.match(/\b(foamy urine|urination|urinate|night to urinate|urinary)\b/)) {
    topics.push("diabetes urinary symptoms");
  }
  if (
    qLower.match(
      /\b(low blood sugar|hypoglyc|high blood sugar|hyperglyc|shaky|sweaty|confusion|vomiting|vision loss|foot ulcer|foot wound|foot infection)\b/,
    )
  ) {
    topics.push("diabetes red flags");
  }

  return Array.from(new Set(topics));
}

function extractTimelineSummary(text: string) {
  return (
    text.match(
      new RegExp(
        `\\b(?:\\d+|(?:${SPELLED_DURATION_WORDS}))\\s*(?:day|week|month|year|hour|minute)s?\\b`,
        "i",
      ),
    ) ??
    text.match(MONTH_YEAR_PATTERN) ??
    text.match(SEASON_YEAR_PATTERN) ??
    text.match(/\b(?:yesterday|today|tonight|this morning|this afternoon|last night)\b/i) ??
    text.match(/\b(?:diagnosed|diagnosis|since)\b(?:\s+\w+){0,6}\s+\b\d{4}\b/i)
  );
}

function hasTimelineAnswerSignal(text: string) {
  return Boolean(extractTimelineSummary(text) || DIAGNOSED_YEAR_PATTERN.test(text));
}

function extractInformationFromAnswers(answers: string[]): InterviewFactSummary {
  if (answers.length === 0) {
    return {
      mentionedTopics: [],
      symptomDetails: [],
      redFlagsMentioned: [],
      informationSummary: "",
      handoffNeeds: [],
    };
  }

  const allAnswersText = answers.join(" ").toLowerCase();
  const mentionedTopics = new Set<ProtocolTopicKey>();
  const symptomDetails: string[] = [];
  const redFlagsMentioned: string[] = [];
  const handoffNeeds: string[] = [];

  if (allAnswersText.match(/\b(\d+\/10|\d+ out of 10|mild|moderate|severe|very severe)\b/i)) {
    mentionedTopics.add("severity");
  }
  if (
    allAnswersText.match(
      /\b(knee|elbow|shoulder|wrist|hand|foot|ankle|back|neck|arm|leg|chest|throat|abdomen|abdominal|stomach|head)\b/,
    )
  ) {
    mentionedTopics.add("location");
  }
  if (hasTimelineAnswerSignal(allAnswersText)) {
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
  if (allAnswersText.match(/\b(cough|congestion|runny nose|rhinorrhea|sinus|cold)\b/)) {
    mentionedTopics.add("uri symptoms");
  }
  if (
    allAnswersText.match(
      /\b(sick contacts?|strep exposure|similar illness|white spots|exudate|swollen tonsils|tonsil swelling)\b/,
    )
  ) {
    mentionedTopics.add("infectious context");
  }
  if (
    allAnswersText.match(
      /\b(trouble swallowing|difficulty swallowing|drooling|muffled voice|neck swelling|stridor|can(?:'|’)t swallow|unable to swallow)\b/,
    )
  ) {
    mentionedTopics.add("throat red flags");
    redFlagsMentioned.push("throat red flags");
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
  if (
    allAnswersText.match(
      /\b(nausea|vomiting|vomit|diarrhea|constipation|bowel|stool|bloody stool|black stool|melena|appetite)\b/,
    )
  ) {
    mentionedTopics.add("bowel symptoms");
  }
  if (allAnswersText.match(/\b(urinary|urine|dysuria|burning|frequency|urgency|hematuria)\b/)) {
    mentionedTopics.add("urinary symptoms");
  }
  if (allAnswersText.match(/\b(pregnan|lmp|last menstrual|period|missed period)\b/)) {
    mentionedTopics.add("pregnancy context");
  }
  if (
    allAnswersText.match(
      /\b(vomiting blood|blood in stool|black stool|melena|hematemesis|faint|syncope|passed out|jaundice|yellow|can(?:'|’)t keep fluids down|unable to keep fluids down|persistent vomiting|rapidly worsening)\b/,
    )
  ) {
    mentionedTopics.add("abdominal red flags");
    redFlagsMentioned.push("abdominal red flags");
  }
  if (
    allAnswersText.match(/\b(metformin|insulin|ozempic|semaglutide|jardiance|glipizide|medication|adherence)\b/)
  ) {
    mentionedTopics.add("diabetes treatment");
  }
  if (MEDICATION_REFILL_PATTERN.test(allAnswersText)) {
    mentionedTopics.add("medication refill need");
    const medicationMatch = allAnswersText.match(
      /\b(?:running out of|run out of|almost out of|running low on|need(?:ing)? (?:a )?refill(?: for)?|renew(?:al)?(?: of)?|need more)\s+([a-z0-9 -]+)/i,
    );
    handoffNeeds.push(
      medicationMatch?.[1]
        ? `Needs refill or prescription review for ${medicationMatch[1].trim()}.`
        : "Needs medication refill or prescription review.",
    );
  }
  if (
    allAnswersText.match(
      /\b(a1c|hba1c|glucose|blood sugar|fasting|postprandial|post-prandial|finger-?stick|cgm)\b/,
    )
  ) {
    mentionedTopics.add("glucose control");
  }
  if (allAnswersText.match(/\b(low blood sugar|hypoglyc|shakiness|sweating|dizziness|feeling faint)\b/)) {
    mentionedTopics.add("diabetes hypoglycemia");
  }
  if (
    allAnswersText.match(
      /\b(high blood sugar|hyperglyc|increased thirst|thirsty|frequent urination|urinating more|polyuria|polydipsia|increased hunger)\b/,
    )
  ) {
    mentionedTopics.add("diabetes hyperglycemia");
  }
  if (allAnswersText.match(/\b(numbness|tingling|burning|loss of sensation|neuropathy)\b/)) {
    mentionedTopics.add("diabetes neuropathy");
  }
  if (allAnswersText.match(/\b(vision|blurry vision|blurred vision|seeing|glasses)\b/)) {
    mentionedTopics.add("diabetes vision");
  }
  if (allAnswersText.match(/\b(chest pain|shortness of breath|leg swelling|ankle swelling)\b/)) {
    mentionedTopics.add("diabetes chest/sob");
  }
  if (allAnswersText.match(/\b(sores|cuts|ulcer|wound|slow healing|infection|infections)\b/)) {
    mentionedTopics.add("diabetes sores/infections");
  }
  if (allAnswersText.match(/\b(fatigue|tired|low energy)\b/)) {
    mentionedTopics.add("diabetes fatigue");
  }
  if (allAnswersText.match(/\b(weight loss|weight gain|unintended weight)\b/)) {
    mentionedTopics.add("diabetes weight change");
  }
  if (allAnswersText.match(/\b(sexual function|erection|erections|libido)\b/)) {
    mentionedTopics.add("diabetes sexual function");
  }
  if (allAnswersText.match(/\b(nausea|vomiting|bloating|full very quickly|stomach)\b/)) {
    mentionedTopics.add("diabetes gi symptoms");
  }
  if (allAnswersText.match(/\b(foamy urine|urination|urinate|night to urinate|urinary)\b/)) {
    mentionedTopics.add("diabetes urinary symptoms");
  }
  if (
    allAnswersText.match(
      /\b(low blood sugar|hypoglyc|high blood sugar|hyperglyc|shakiness|sweating|confusion|vomiting|vision loss|foot ulcer|foot wound|foot infection)\b/,
    )
  ) {
    mentionedTopics.add("diabetes red flags");
    redFlagsMentioned.push("diabetes red flags");
  }

  const durationMatch = extractTimelineSummary(allAnswersText);
  if (durationMatch) symptomDetails.push(`Duration: ${durationMatch[0]}`);
  const severityMatch = allAnswersText.match(/\b(\d+\/10|\d+ out of 10|mild|moderate|severe)\b/i);
  if (severityMatch) symptomDetails.push(`Severity: ${severityMatch[0]}`);
  if (MEDICATION_REFILL_PATTERN.test(allAnswersText)) {
    const medicationMatch = allAnswersText.match(
      /\b(?:running out of|run out of|almost out of|running low on|need(?:ing)? (?:a )?refill(?: for)?|renew(?:al)?(?: of)?|need more)\s+([a-z0-9 -]+)/i,
    );
    symptomDetails.push(
      medicationMatch?.[1]
        ? `Handoff need: running out of ${medicationMatch[1].trim()}`
        : "Handoff need: medication refill requested",
    );
  }

  return {
    mentionedTopics: Array.from(mentionedTopics),
    symptomDetails,
    redFlagsMentioned,
    informationSummary: symptomDetails.concat(handoffNeeds).join("; "),
    handoffNeeds,
  };
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeConditionConcern(value: string) {
  const normalized = normalizeComplaintText(value);
  const matchedCondition = CONDITION_LAB_DYNAMIC_COMPLAINTS.find((item) => item.pattern.test(normalized));
  return matchedCondition?.label ?? null;
}

function splitComplaints(chiefComplaint: string) {
  const complaints = chiefComplaint
    .split(/[,\n]| and |; /)
    .map((complaint) => complaint.trim())
    .filter((complaint) => complaint.length > 0);

  if (complaints.length <= 1) {
    return complaints;
  }

  const uriComponentPattern =
    /\b(sore throat|cough|coughing|congestion|runny nose|rhinorrhea|sinus|uri|upper respiratory|cold)\b/i;
  if (complaints.every((complaint) => uriComponentPattern.test(complaint))) {
    return [chiefComplaint.trim()];
  }

  return complaints;
}

function getComplaintKeywords(complaint: string) {
  return normalizeComplaintText(complaint)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !COMPLAINT_KEYWORD_STOPWORDS.has(word));
}

function complaintsAreEquivalent(left: string, right: string) {
  const leftNormalized = normalizeComplaintText(left);
  const rightNormalized = normalizeComplaintText(right);
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;
  const leftConditionConcern = normalizeConditionConcern(left);
  const rightConditionConcern = normalizeConditionConcern(right);
  if (leftConditionConcern && rightConditionConcern && leftConditionConcern === rightConditionConcern) {
    return true;
  }
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getBodyPartNegationTerms(part: ReturnType<typeof detectBodyParts>[number]) {
  switch (part.part) {
    case "chest":
      return ["chest", "breast", "breasts", "breastbone", "sternum"];
    case "abdomen":
      return ["abdomen", "abdominal", "stomach", "belly"];
    default:
      return [part.name];
  }
}

function hasNegatedPainForBodyPart(message: string, part: ReturnType<typeof detectBodyParts>[number]) {
  const termsPattern = getBodyPartNegationTerms(part).map(escapeRegex).join("|");
  return new RegExp(
    `\\b(?:no|not|without|denies|denied|deny|negative for)\\s+(?:\\w+\\s+){0,2}(?:${termsPattern})\\s+pain\\b`,
  ).test(message);
}

function extractConcernStyleCandidates(message: string): string[] {
  const lower = message.toLowerCase();
  if (!hasExplicitFollowUpConcernCue(lower)) {
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

    const normalizedPhrase = normalizeComplaintText(cleanedPhrase);
    const lowerPhrase = normalizedPhrase.toLowerCase();
    if (CONDITION_LAB_DYNAMIC_COMPLAINTS.some((item) => item.pattern.test(lowerPhrase))) {
      return;
    }

    const hasBodyPart = detectBodyParts(normalizedPhrase).length > 0;
    const hasKnownComplaintClass = classifyComplaint(normalizedPhrase) !== "General";
    const hasMedicalConcernKeyword = MEDICAL_CONCERN_KEYWORD_PATTERN.test(lowerPhrase);

    if (hasBodyPart || hasKnownComplaintClass || hasMedicalConcernKeyword) {
      candidates.push(normalizedPhrase);
    }
  });

  return Array.from(new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)));
}

function hasExplicitFollowUpConcernCue(message: string) {
  const lower = message.toLowerCase();
  return (
    DYNAMIC_COMPLAINT_CUE_PATTERN.test(lower) ||
    CONCERN_STYLE_CUE_PATTERN.test(lower) ||
    (RESULT_FOLLOW_UP_PATTERN.test(lower) && MEDICAL_CONCERN_KEYWORD_PATTERN.test(lower))
  );
}

function extractDynamicComplaintCandidates(
  message: string,
  patientTurnIndex: number,
): string[] {
  const lower = message.toLowerCase();
  const hasSymptomCue = patientTurnIndex > 0 && DYNAMIC_COMPLAINT_CUE_PATTERN.test(lower);
  const hasConcernCue = hasExplicitFollowUpConcernCue(lower);
  if (!hasSymptomCue && !hasConcernCue) return [];

  const candidates: string[] = [];
  if (hasSymptomCue && SYMPTOM_CONTEXT_PATTERN.test(lower)) {
    if (DISTINCT_COUGH_PATTERN.test(lower)) {
      candidates.push("cough");
    }
    if (/\bheadache|migraine\b/.test(lower)) {
      candidates.push("headache");
    }
    detectBodyParts(message).forEach((part) => {
      if (part.part === "head" && /\bheadache|migraine\b/.test(lower)) {
        return;
      }
      const side = part.side ? `${part.side} ` : "";
      if (/\b(lump|mass|bump)\b/.test(lower)) {
        candidates.push(`${side}${part.name} lump`);
        return;
      }
      if (/\b(rash|lesion|wound|ulcer)\b/.test(lower)) {
        candidates.push(`${side}${part.name} rash`);
        return;
      }
      if (hasNegatedPainForBodyPart(lower, part)) {
        return;
      }
      candidates.push(`${side}${part.name} pain`);
    });

    if (candidates.length === 0) {
      const nonMskNegationPattern = /\b(no|not|none|never|without|denies|denied|deny|negative for)\b/;
      NON_MSK_DYNAMIC_COMPLAINTS.forEach((item) => {
        if (hasPositiveUnnegatedSignal(lower, item.pattern, nonMskNegationPattern)) {
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

function classifyDynamicComplaintDisposition(message: string, candidate: string): DynamicComplaintDisposition {
  const lower = message.toLowerCase();
  const candidateConditionConcern = normalizeConditionConcern(candidate);
  const candidateMentionedAsConcern =
    CONCERN_STYLE_CUE_PATTERN.test(lower) &&
    (lower.includes(candidate.toLowerCase()) || messageMentionsComplaint(message, candidate));
  const isResultFollowUpConcern =
    candidateConditionConcern !== null &&
    RESULT_FOLLOW_UP_PATTERN.test(lower) &&
    MEDICAL_CONCERN_KEYWORD_PATTERN.test(lower);

  if (URGENT_SECONDARY_COMPLAINT_PATTERN.test(lower)) {
    return "full_workup";
  }

  if (isResultFollowUpConcern) {
    return "full_workup";
  }

  if (RESOLVED_SECONDARY_COMPLAINT_PATTERN.test(lower)) {
    return "brief_safety_screen";
  }

  if (
    HISTORICAL_SECONDARY_COMPLAINT_PATTERN.test(lower) &&
    !ACTIVE_SECONDARY_COMPLAINT_PATTERN.test(lower) &&
    !candidateMentionedAsConcern
  ) {
    return "brief_safety_screen";
  }

  return "full_workup";
}

function extractDynamicComplaintDetections(
  message: string,
  patientTurnIndex: number,
): DynamicComplaintDetection[] {
  return extractDynamicComplaintCandidates(message, patientTurnIndex).map((complaint) => ({
    complaint,
    disposition: classifyDynamicComplaintDisposition(message, complaint),
  }));
}

function shouldPromoteBriefConcernFromFollowUp(answer: string) {
  const lower = answer.toLowerCase();
  return PROMOTE_BRIEF_CONCERN_PATTERN.test(lower) && !REASSURING_BRIEF_CONCERN_PATTERN.test(lower);
}

function buildComplaintSeeds(
  chiefComplaint: string,
  detectedComplaints: string[],
): {
  complaintSeeds: ComplaintSeed[];
  briefSecondaryConcerns: BriefSecondaryConcern[];
} {
  const seeds: ComplaintSeed[] = splitComplaints(chiefComplaint).map((complaint) => ({
    complaint: normalizeComplaintText(complaint),
    originalComplaint: complaint,
    source: "chief_complaint",
    addedMidInterview: false,
    firstDetectedAtMessageIndex: null,
  }));

  detectedComplaints.forEach((complaint) => {
    const normalized = normalizeComplaintText(complaint);
    const alreadyTracked = seeds.some((seed) => complaintsAreEquivalent(seed.complaint, normalized));
    if (!alreadyTracked) {
      seeds.push({
        complaint: normalized,
        originalComplaint: complaint,
        source: "transcript",
        addedMidInterview: true,
        firstDetectedAtMessageIndex: null,
      });
    }
  });

  if (seeds.length === 0) {
    return {
      complaintSeeds: [
        {
          complaint: normalizeComplaintText(chiefComplaint),
          originalComplaint: chiefComplaint,
          source: "chief_complaint",
          addedMidInterview: false,
          firstDetectedAtMessageIndex: null,
        },
      ],
      briefSecondaryConcerns: [],
    };
  }

  return {
    complaintSeeds: seeds,
    briefSecondaryConcerns: [],
  };
}

function messageMentionsComplaint(message: string, complaint: string) {
  const lowerMessage = normalizeComplaintText(message);
  const complaintText = normalizeComplaintText(complaint);
  if (lowerMessage.includes(complaintText)) return true;
  const normalizedConcern = normalizeConditionConcern(complaint);
  if (normalizedConcern) {
    const matchedCondition = CONDITION_LAB_DYNAMIC_COMPLAINTS.find((item) => item.label === normalizedConcern);
    if (matchedCondition?.pattern.test(lowerMessage)) {
      return true;
    }
  }

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
  if (check.key === "diabetes_red_flags_screen") {
    return isDiabetesRedFlagsCovered(coveredTopics, patientAnswers);
  }
  return check.coverageTopics.some((topic) => coveredTopics.has(topic));
}

function isCheckApplicable(check: ProtocolCheck, patientProfile: PatientProfile) {
  if (check.key !== "pregnancy_context") {
    return true;
  }

  const pregnancyRelevantSex =
    patientProfile.sex === "female" || patientProfile.sex === "nonbinary";
  return pregnancyRelevantSex && patientProfile.age >= 12 && patientProfile.age <= 55;
}

function shouldAskSoreThroatInfectiousContext(
  complaint: string,
  coveredTopics: Set<ProtocolTopicKey>,
  patientAnswers: string[],
) {
  if (!/\b(sore throat|strep|pharyng|tonsil)\b/i.test(complaint)) {
    return false;
  }

  if (coveredTopics.has("infectious context") || coveredTopics.has("exudate")) {
    return false;
  }

  const answersText = patientAnswers.join(" ").toLowerCase();
  const hasFever = /\b(fever|febrile|temperature)\b/.test(answersText);
  const hasNegatedUriFeatures =
    /\b(no|denies|without)\s+(?:\w+\s+){0,2}(cough|congestion|runny nose|rhinorrhea|cold)\b/.test(
      answersText,
    );
  const hasUriFeatures =
    /\b(cough|congestion|runny nose|rhinorrhea|cold)\b/.test(answersText) && !hasNegatedUriFeatures;
  const hasThroatFocusedSymptoms =
    /\b(painful swallowing|trouble swallowing|difficulty swallowing|swallow)\b/.test(answersText);

  return hasFever && hasThroatFocusedSymptoms && !hasUriFeatures;
}

const DIABETES_DUPLICATE_DOMAIN_TOPICS: ProtocolTopicKey[] = [
  "diabetes hypoglycemia",
  "diabetes hyperglycemia",
  "diabetes neuropathy",
  "diabetes vision",
  "diabetes chest/sob",
  "diabetes sores/infections",
  "diabetes fatigue",
  "diabetes weight change",
  "diabetes sexual function",
  "diabetes gi symptoms",
  "diabetes urinary symptoms",
];

function hasPositiveUnnegatedSignal(text: string, signalPattern: RegExp, negationPattern: RegExp) {
  return text.split(/[.!?;\n]/).some((chunk) => signalPattern.test(chunk) && !negationPattern.test(chunk));
}

function isDiabetesRedFlagsCovered(
  coveredTopics: Set<ProtocolTopicKey>,
  patientAnswers: string[],
) {
  if (coveredTopics.has("diabetes red flags")) {
    return true;
  }

  const coveredDomainCount = DIABETES_DUPLICATE_DOMAIN_TOPICS.filter((topic) =>
    coveredTopics.has(topic),
  ).length;
  if (coveredDomainCount >= 2) {
    return true;
  }

  const answersText = patientAnswers.join(" ").toLowerCase();
  return /\b(no symptoms|none|none whatsoever|not at all|things seem to be okay|overall well controlled)\b/.test(
    answersText,
  );
}

function hasPositiveUrgentDiabetesConcern(patientAnswers: string[]) {
  const answersText = patientAnswers.join(" ").toLowerCase();
  return hasPositiveUnnegatedSignal(
    answersText,
    /\b(low blood sugar|hypoglyc|shakiness|sweating|confusion|increased thirst|frequent urination|vomiting|vision loss|foot ulcer|foot wound|foot infection|chest pain|shortness of breath)\b/,
    /\b(no|denies|without|none|not)\s+(?:\w+\s+){0,3}(low blood sugar|hypoglyc|shakiness|sweating|confusion|increased thirst|frequent urination|vomiting|vision loss|foot ulcer|foot wound|foot infection|chest pain|shortness of breath)\b/,
  );
}

function hasRecentA1c(patientAnswers: string[]) {
  const answersText = patientAnswers.join(" ").toLowerCase();
  return /\b(a1c|hba1c)\b/.test(answersText);
}

function hasHomeGlucosePattern(patientAnswers: string[]) {
  const answersText = patientAnswers.join(" ").toLowerCase();
  return /\b(fasting|postprandial|post-prandial|finger-?stick|cgm|home (?:glucose|readings)|check(?:ing)? .*?(?:week|day)|blood sugar|glucose)\b/.test(
    answersText,
  );
}

function shouldSummarizeStableDiabetesEarly(params: {
  protocolId: string;
  coveredTopics: Set<ProtocolTopicKey>;
  patientAnswers: string[];
}) {
  if (params.protocolId !== "diabetes-follow-up") {
    return false;
  }

  const diagnosisCovered = params.coveredTopics.has("duration/onset");
  const treatmentCovered = params.coveredTopics.has("diabetes treatment");
  const a1cCovered = hasRecentA1c(params.patientAnswers);
  const glucosePatternCovered = hasHomeGlucosePattern(params.patientAnswers);
  const redFlagsCovered = isDiabetesRedFlagsCovered(params.coveredTopics, params.patientAnswers);

  return (
    diagnosisCovered &&
    treatmentCovered &&
    a1cCovered &&
    glucosePatternCovered &&
    redFlagsCovered &&
    !hasPositiveUrgentDiabetesConcern(params.patientAnswers)
  );
}

function evaluateComplaintScope(params: {
  chiefComplaint: string;
  complaint: string;
  originalComplaint: string;
  patientProfile: PatientProfile;
  patientBackground: string | null;
  formSummary: string | null;
  scope: ComplaintScopeAccumulator;
}): EvaluatedComplaintScope {
  const coveredTopics = new Set<ProtocolTopicKey>();
  params.scope.assistantQuestions.forEach((question, index) => {
    if (!params.scope.patientAnswers[index]?.trim()) return;
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
  const routing = resolveComplaintRouting({
    complaint: params.originalComplaint,
    visitStage,
  });
  const protocol = routing.protocol;
  const applicableRequiredFields = protocol.requiredFields.filter((check) =>
    isCheckApplicable(check, params.patientProfile),
  );
  const applicableRedFlags = protocol.redFlags.filter((check) =>
    isCheckApplicable(check, params.patientProfile),
  );
  const applicableVirtualExamFields = protocol.virtualExamFields.filter((check) =>
    isCheckApplicable(check, params.patientProfile),
  );
  const missingRequiredFields = applicableRequiredFields.filter(
    (check) => !isCovered(check, coveredTopics, params.scope.patientAnswers),
  ).filter((check) => {
    if (check.key !== "infectious_context") {
      return true;
    }
    return shouldAskSoreThroatInfectiousContext(
      params.complaint,
      coveredTopics,
      params.scope.patientAnswers,
    );
  });
  const missingRedFlags = applicableRedFlags.filter(
    (check) => !isCovered(check, coveredTopics, params.scope.patientAnswers),
  );
  const missingVirtualExamFields = applicableVirtualExamFields.filter(
    (check) => !isCovered(check, coveredTopics, params.scope.patientAnswers),
  );

  return {
    complaintClass: routing.complaintClass,
    visitStage,
    protocol,
    complaintClarificationHint: routing.clarificationHint,
    coveredTopics,
    patientFacts,
    missingRequiredFields,
    missingRedFlags,
    missingVirtualExamFields,
    completed:
      missingRequiredFields.length === 0 &&
      (!protocol.stopConditions.requireRedFlags || missingRedFlags.length === 0) &&
      (!protocol.stopConditions.requireVirtualExamWhenApplicable ||
        applicableVirtualExamFields.length === 0 ||
        missingVirtualExamFields.length === 0),
  };
}

function buildComplaintScopes(params: {
  chiefComplaint: string;
  complaintSeeds: ComplaintSeed[];
  transcript: InterviewMessage[];
  patientProfile: PatientProfile;
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
        originalComplaint: params.complaintSeeds[activeComplaintIndex].originalComplaint,
        patientProfile: params.patientProfile,
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
      /\b(loss of consciousness|faint|syncope|hemoptysis|gi bleed|melena|hematemesis|vision loss|focal weakness|severe pain|thunderclap|stridor|drooling|unable to swallow|can't swallow|persistent vomiting|jaundice|confusion|foot ulcer|foot infection|chest pain|heart attack|cardiac arrest|radiating to (my )?(arm|jaw|neck|shoulder|back)|crushing chest|pressure in (my )?chest|tightness in (my )?chest|can't breathe|cannot breathe|difficulty breathing|shortness of breath|sob|stroke|facial droop|arm weakness|slurred speech|sudden numbness|anaphylaxis|severe allergic|can't stop bleeding|uncontrolled bleeding|overdose|suicidal|suicide|seizure|convuls)\b/,
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
  // Budget remains advisory telemetry only in the controller-first flow.
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

function looksLikeActiveComplaintDenial(answer: string, activeComplaint: string) {
  const normalizedAnswer = normalizeText(answer);
  const normalizedComplaint = normalizeText(activeComplaint);
  if (!normalizedAnswer || !normalizedComplaint) {
    return false;
  }
  if (!COMPLAINT_DENIAL_PATTERN.test(normalizedAnswer)) {
    return false;
  }

  const complaintRegex = new RegExp(
    `\\b(?:no|not|none|never|without)(?:\\s+\\w+){0,4}\\s+${escapeRegExp(normalizedComplaint)}\\b`,
  );
  if (complaintRegex.test(normalizedAnswer)) {
    return true;
  }

  const complaintKeywords = getComplaintKeywords(activeComplaint);
  return complaintKeywords.some((keyword) =>
    new RegExp(
      `\\b(?:no|not|none|never|without)(?:\\s+\\w+){0,3}\\s+${escapeRegExp(keyword)}\\b`,
    ).test(normalizedAnswer),
  );
}

function detectUnresolvedClarification(patientAnswers: string[], activeComplaint: string) {
  const lastAnswer = patientAnswers.at(-1)?.trim().toLowerCase() ?? "";
  if (!lastAnswer) return null;
  if (
    /\b(not sure|i don't know|idk|maybe|stuff|things|what do you mean|don't understand)\b/.test(lastAnswer) ||
    EXPLICIT_CORRECTION_PATTERN.test(lastAnswer)
  ) {
    return lastAnswer;
  }
  if (looksLikeActiveComplaintDenial(lastAnswer, activeComplaint)) {
    return `whether you are denying ${activeComplaint} and want to focus on another concern instead`;
  }
  return null;
}

function countClarificationAttempts(transcript: InterviewMessage[]) {
  return transcript.filter(
    (message) =>
      message.role === "assistant" && CLARIFICATION_REQUEST_PATTERN.test(message.content.toLowerCase()),
  ).length;
}

function countExplicitCorrections(patientAnswers: string[], activeComplaint: string) {
  return patientAnswers.filter((answer) => {
    const normalized = answer.toLowerCase();
    return (
      EXPLICIT_CORRECTION_PATTERN.test(normalized) ||
      looksLikeActiveComplaintDenial(answer, activeComplaint)
    );
  }).length;
}

function countPendingConcernRedirects(transcript: InterviewMessage[], pendingComplaints: string[]) {
  if (pendingComplaints.length === 0) {
    return 0;
  }

  return transcript.filter((message) => {
    if (message.role !== "patient") {
      return false;
    }

    const normalized = message.content.toLowerCase();
    if (
      !PENDING_CONCERN_REDIRECT_PATTERN.test(normalized) &&
      !hasExplicitFollowUpConcernCue(normalized)
    ) {
      return false;
    }

    return pendingComplaints.some((complaint) => messageMentionsComplaint(message.content, complaint));
  }).length;
}

function determineHistoryConfidence(params: {
  transcript: InterviewMessage[];
  patientAnswers: string[];
  unresolvedClarification: string | null;
  activeComplaint: string;
}) {
  const clarificationAttemptCount = countClarificationAttempts(params.transcript);
  const explicitCorrectionCount = countExplicitCorrections(
    params.patientAnswers,
    params.activeComplaint,
  );

  if (!params.unresolvedClarification) {
    return {
      historyConfidence: "clear" as const,
      clarificationAttemptCount,
      shouldEndEarlyForUnclearHistory: false,
      earlyStopReason: null,
    };
  }

  if (clarificationAttemptCount >= 1 || explicitCorrectionCount >= 2) {
    return {
      historyConfidence: "unsafe_to_continue" as const,
      clarificationAttemptCount,
      shouldEndEarlyForUnclearHistory: true,
      earlyStopReason:
        "History confidence dropped below a safe threshold after clarification or repeated correction.",
    };
  }

  return {
    historyConfidence: "needs_clarification" as const,
    clarificationAttemptCount,
    shouldEndEarlyForUnclearHistory: false,
    earlyStopReason: null,
  };
}

function buildComplaintProgress(params: {
  complaintSeed: ComplaintSeed;
  status: ComplaintStatus;
  scope: ComplaintScopeAccumulator;
  evaluation: EvaluatedComplaintScope;
}): ComplaintProgress {
  return {
    complaint: params.complaintSeed.complaint,
    originalComplaint: params.complaintSeed.originalComplaint,
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

  const unresolvedBucketEstimate =
    (progress.needsOpeningNarrative ? 1 : 0) +
    Math.ceil(progress.missingRequiredFieldKeys.length * 0.8) +
    Math.ceil(progress.missingRedFlagKeys.length / 3) +
    Math.ceil(progress.missingVirtualExamKeys.length * 0.75);

  return Math.max(unresolvedBucketEstimate, 1);
}

export function estimateInterviewProgress(state: {
  complaintQueue: ComplaintProgress[];
  activeComplaint: string;
  totalQuestionCount: number;
  remainingFormCoverageHints: string[];
  unresolvedClarification: string | null;
  summaryReady: boolean;
  shouldEarlyStop: boolean;
  shouldEndEarlyForUnclearHistory: boolean;
  forceSummary: boolean;
}): InterviewProgress {
  // Progress remains approximate UI telemetry; controller decisions do not depend on it.
  const baseAsked = state.totalQuestionCount;
  if (state.forceSummary || state.summaryReady || state.shouldEarlyStop || state.shouldEndEarlyForUnclearHistory) {
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
  detectedComplaints?: string[];
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

  const { complaintSeeds, briefSecondaryConcerns } = buildComplaintSeeds(
    params.chiefComplaint,
    params.detectedComplaints ?? [],
  );
  const complaintScopes = buildComplaintScopes({
    chiefComplaint: params.chiefComplaint,
    complaintSeeds,
    transcript: params.transcript,
    patientProfile: params.patientProfile,
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
      originalComplaint: seed.originalComplaint,
      patientProfile: params.patientProfile,
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
    originalComplaint: activeComplaintProgress?.originalComplaint ?? params.chiefComplaint,
    patientProfile: params.patientProfile,
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
  const hasFormCatchUpWork =
    phaseState.hasStructuredForm &&
    phaseState.phase === "form_phase" &&
    remainingFormCoverageHints.length > 0;
  const pendingComplaints = complaintQueue
    .filter((item) => item.status === "pending")
    .map((item) => item.complaint);
  const repeatedPendingConcernRedirectCount = countPendingConcernRedirects(
    params.transcript,
    pendingComplaints,
  );
  const shouldSummarizeAfterRepeatedRedirection =
    !params.forceSummary &&
    repeatedPendingConcernRedirectCount >= 2 &&
    pendingComplaints.length > 0 &&
    activeScope.activeAssistantQuestions.length >= 2 &&
    !hasFormCatchUpWork;
  const shouldEscalateSoreThroatRedFlags =
    activeEvaluation.protocol.id === "sore-throat-uri" &&
    activeEvaluation.patientFacts.redFlagsMentioned.includes("throat red flags");
  const shouldEarlyStop =
    !params.forceSummary &&
    (fatigueSignals.active && allQuestionsAsked.length >= 6) &&
    !hasFormCatchUpWork &&
    !(phaseState.hasStructuredForm && phaseState.phase === "hpi_phase");

  const unresolvedClarification = detectUnresolvedClarification(
    patientAnswers,
    activeComplaint,
  );
  const historyConfidenceState = determineHistoryConfidence({
    transcript: params.transcript,
    patientAnswers,
    unresolvedClarification,
    activeComplaint,
  });
  const shouldSummarizeStableDiabetes =
    !params.forceSummary &&
    shouldSummarizeStableDiabetesEarly({
      protocolId: activeEvaluation.protocol.id,
      coveredTopics: activeEvaluation.coveredTopics,
      patientAnswers: activeScope.patientAnswers,
    });
  const summaryReady =
    params.forceSummary ||
    shouldEscalateSoreThroatRedFlags ||
    shouldSummarizeStableDiabetes ||
    historyConfidenceState.shouldEndEarlyForUnclearHistory ||
    (!unresolvedClarification &&
      allComplete &&
      (!phaseState.hasStructuredForm || remainingFormCoverageHints.length === 0 || shouldEarlyStop));

  const interviewState: Omit<InterviewState, "progress"> = {
    chiefComplaint: params.chiefComplaint,
    complaints: complaintQueue.map((item) => item.complaint),
    pendingComplaints,
    briefSecondaryConcerns,
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
    activeHandoffNeeds: activeEvaluation.patientFacts.handoffNeeds,
    questionCountSoFar: activeScope.activeAssistantQuestions.length,
    totalQuestionCount: allQuestionsAsked.length,
    allQuestionsAsked,
    patientAnswers,
    coveredTopics: Array.from(topicsCovered),
    patientFacts,
    handoffNeeds: patientFacts.handoffNeeds,
    missingRequiredFields: activeEvaluation.missingRequiredFields,
    missingRedFlags: activeEvaluation.missingRedFlags,
    missingVirtualExamFields: activeEvaluation.missingVirtualExamFields,
    remainingFormCoverageHints,
    // Only elevate urgency when an actual red-flag signal was DETECTED in the patient's
    // answers. missingRedFlags.length > 0 only means some screening checks weren't
    // covered yet — it does NOT mean a red flag was found — so it must NOT trigger
    // the emergency SMS alert.
    urgency: escalation.hasRedFlagSignal ? "elevated" : "routine",
    questionBudget: budget.budget,
    questionBudgetModifiers: budget.modifiers,
    escalationReasons: escalation.reasons,
    newComplaintCount,
    shouldEarlyStop,
    summaryReady,
    historyConfidence: historyConfidenceState.historyConfidence,
    clarificationAttemptCount: historyConfidenceState.clarificationAttemptCount,
    shouldEndEarlyForUnclearHistory: historyConfidenceState.shouldEndEarlyForUnclearHistory,
    repeatedPendingConcernRedirectCount,
    shouldSummarizeAfterRepeatedRedirection,
    earlyStopReason: historyConfidenceState.earlyStopReason,
    unresolvedClarification,
    complaintClarificationHint: activeEvaluation.complaintClarificationHint,
    deferredIntentHint: params.deferredIntentHint,
    forceSummary: params.forceSummary,
  };

  return {
    ...interviewState,
    progress: estimateInterviewProgress(interviewState),
  };
}
