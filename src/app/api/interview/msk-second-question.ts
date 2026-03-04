import type { BodyPart, BodyPartInfo } from "@/lib/body-parts";
import { detectBodyParts } from "@/lib/body-parts";
import type { InterviewMessage, InterviewResponse } from "@/lib/interview-schema";
import {
  hasBodyPartLocationAnswerSignal,
  hasLocationQuestionIntent,
} from "./location-signals";

const mskBodyPartSet = new Set<BodyPart>([
  "wrist",
  "hand",
  "elbow",
  "shoulder",
  "neck",
  "back",
  "lower_back",
  "upper_back",
  "knee",
  "ankle",
  "foot",
  "hip",
]);

const mskCheckpointAssistantCounts = new Set([1, 4, 9]);

const negationPattern =
  /\b(no|not|without|denies|deny|denied|never|none|free of|don['’]t|do not|doesn['’]t|does not|isn['’]t|is not|am not|aren['’]t|are not|haven['’]t|have not|hadn['’]t|had not)\b/;
const symptomContextPattern =
  /\b(pain|painful|hurt|hurts|hurting|ache|aching|swelling|swollen|tender|tenderness|sore|stiff|stiffness|injury|injured|sprain|strain|numb|numbness|tingling|weakness|limited|limit(ed|ation)?|limp|limping|deformity|bruise|bruising)\b/;

const bodyPartMentionPattern: Record<BodyPart, RegExp> = {
  wrist: /\b(wrist|wrists)\b/,
  hand: /\b(hand|hands)\b/,
  elbow: /\b(elbow|elbows|forearm|forearms)\b/,
  shoulder: /\b(shoulder|shoulders)\b/,
  neck: /\b(neck|cervical|thyroid)\b/,
  back: /\b(back)\b/,
  lower_back: /\b(lower\s+back|low\s+back|lumbar)\b/,
  upper_back: /\b(upper\s+back|upper\s+spine|thoracic)\b/,
  knee: /\b(knee|knees)\b/,
  ankle: /\b(ankle|ankles|lower\s+leg|shin|shins|calf|calves)\b/,
  foot: /\b(foot|feet|heel|heels|sole|plantar|arch)\b/,
  hip: /\b(hip|hips|upper\s+leg|upper\s+thigh|thigh|thighs)\b/,
  head: /\b(head|headache|headaches|scalp|face|facial)\b/,
  chest: /\b(chest|breast|breasts|breastbone|sternum|anterior\s+neck|front\s+of\s+neck)\b/,
  abdomen: /\b(abdomen|abdominal|stomach|belly)\b/,
};

function hasNegatedBodyPartMention(textLower: string, part: BodyPart): boolean {
  const mention = bodyPartMentionPattern[part];
  if (!mention) return false;
  const tokens = textLower.split(/[.!?;\n]/).map((segment) => segment.trim());
  return tokens.some((segment) => {
    if (!mention.test(segment)) return false;
    const mentionIndex = segment.search(mention);
    if (mentionIndex === -1) return false;
    const prefix = segment.slice(0, mentionIndex);
    // Keep the scope narrow to avoid over-filtering distant negations.
    const nearbyPrefix = prefix.slice(-60);
    return negationPattern.test(nearbyPrefix);
  });
}

function getPatientReportedMskParts(transcript: InterviewMessage[]): BodyPartInfo[] {
  const patientMessages = transcript.filter((message) => message.role === "patient");
  const inferred: BodyPartInfo[] = [];
  for (const message of patientMessages) {
    const lower = message.content.toLowerCase();
    const detected = dedupeMskParts(detectBodyParts(message.content));
    for (const detectedPart of detected) {
      if (hasNegatedBodyPartMention(lower, detectedPart.part)) {
        continue;
      }
      const hasMarkerEvidence = hasBodyPartLocationAnswerSignal(lower, detectedPart.part);
      const hasSymptomContext = lower
        .split(/[.!?;\n]/)
        .map((segment) => segment.trim())
        .some((segment) => {
          if (!segment || !symptomContextPattern.test(segment)) return false;
          return bodyPartMentionPattern[detectedPart.part]?.test(segment) ?? false;
        });
      if (!hasMarkerEvidence && !hasSymptomContext) {
        continue;
      }
      inferred.push(detectedPart);
    }
  }
  return dedupeMskParts(inferred);
}

const forcedLocationQuestionByLanguage: Record<string, string> = {
  en: "Looking at the diagram/photo of your {bodyParts}, please mark exactly where the pain is most noticeable.",
  es: "Mirando el diagrama/foto de su(s) {bodyParts}, por favor marque exactamente dónde nota más dolor.",
  fr: "En regardant le schéma/photo de vos {bodyParts}, veuillez marquer exactement où la douleur est la plus marquée.",
  de: "Bitte markieren Sie im Diagramm/Foto Ihrer {bodyParts} genau die Stelle, an der der Schmerz am stärksten ist.",
  it: "Guardando il diagramma/foto del/della {bodyParts}, indichi esattamente dove il dolore è più evidente.",
  pt: "Olhando para o diagrama/foto do(a) seu(sua) {bodyParts}, marque exatamente onde a dor é mais intensa.",
  zh: "请查看您{bodyParts}的示意图/照片，并准确标记疼痛最明显的位置。",
  ja: "{bodyParts}の図/写真を見て、痛みが最も強い場所を正確にマークしてください。",
  ko: "{bodyParts}의 도표/사진을 보고 통증이 가장 뚜렷한 위치를 정확히 표시해 주세요.",
  ar: "بالنظر إلى المخطط/الصورة الخاصة بـ {bodyParts}، يرجى تحديد المكان الذي يكون فيه الألم أشد ما يمكن.",
  hi: "अपने {bodyParts} के डायग्राम/फोटो को देखकर कृपया ठीक उस जगह को चिन्हित करें जहां दर्द सबसे अधिक है।",
  fa: "با نگاه کردن به نمودار/عکس {bodyParts}، لطفاً دقیقاً محل بیشترین درد را علامت بزنید.",
};

function dedupeMskParts(parts: BodyPartInfo[]): BodyPartInfo[] {
  const seen = new Set<BodyPart>();
  const deduped: BodyPartInfo[] = [];
  for (const partInfo of parts) {
    if (!mskBodyPartSet.has(partInfo.part) || seen.has(partInfo.part)) {
      continue;
    }
    seen.add(partInfo.part);
    deduped.push({ part: partInfo.part, name: partInfo.name });
  }
  return deduped;
}

function formatBodyPartList(partNames: string[]): string {
  if (partNames.length === 0) {
    return "affected area";
  }
  if (partNames.length === 1) {
    return partNames[0];
  }
  if (partNames.length === 2) {
    return `${partNames[0]} and ${partNames[1]}`;
  }
  return `${partNames.slice(0, -1).join(", ")}, and ${partNames.at(-1)}`;
}

function buildForcedLocationQuestion(languageCode: string, bodyPartNames: string[]): string {
  const template =
    forcedLocationQuestionByLanguage[languageCode] ?? forcedLocationQuestionByLanguage.en;
  return template.replace("{bodyParts}", formatBodyPartList(bodyPartNames));
}

export function getRequiredMskParts(
  chiefComplaint: string,
  transcript: InterviewMessage[],
): BodyPartInfo[] {
  const fromChiefComplaint = dedupeMskParts(detectBodyParts(chiefComplaint));
  const fromTranscript = getPatientReportedMskParts(transcript);
  return dedupeMskParts([...fromChiefComplaint, ...fromTranscript]);
}

function getMarkedMskParts(requiredParts: BodyPartInfo[], transcript: InterviewMessage[]): Set<BodyPart> {
  const patientAnswers = transcript
    .filter((message) => message.role === "patient")
    .map((message) => message.content.trim().toLowerCase())
    .filter((content) => content.length > 0);
  const marked = new Set<BodyPart>();

  for (const requiredPart of requiredParts) {
    const hasPartCoverage = patientAnswers.some((answer) =>
      hasBodyPartLocationAnswerSignal(answer, requiredPart.part),
    );
    if (hasPartCoverage) {
      marked.add(requiredPart.part);
    }
  }
  return marked;
}

export function getMskDiagramProgress(chiefComplaint: string, transcript: InterviewMessage[]) {
  const requiredParts = getRequiredMskParts(chiefComplaint, transcript);
  const markedParts = getMarkedMskParts(requiredParts, transcript);
  const remainingParts = requiredParts.filter((part) => !markedParts.has(part.part));
  return {
    isMskComplaint: requiredParts.length > 0,
    requiredParts,
    markedParts,
    remainingParts,
    remainingPartNames: remainingParts.map((part) => part.name),
  };
}

function extractDeferredIntentHint(turn: InterviewResponse): string | null {
  if (turn.type !== "question") return null;
  const question = turn.question.trim();
  if (!question) return null;
  const lower = question.toLowerCase();
  const looksLikeLocationQuestion =
    hasLocationQuestionIntent(lower) ||
    (/\b(diagram|photo|image)\b/.test(lower) && /\b(mark|click|tap|point)\b/.test(lower));
  if (looksLikeLocationQuestion) return null;
  const rationale = typeof turn.rationale === "string" ? turn.rationale.trim() : "";
  const hint = rationale ? `${question} | Intent: ${rationale}` : question;
  return hint.slice(0, 500);
}

export function applyMskSecondQuestionOverride(args: {
  turn: InterviewResponse;
  transcript: InterviewMessage[];
  chiefComplaint: string;
  forceSummary: boolean;
  languageCode: string;
}): InterviewResponse {
  const assistantQuestionsAsked = args.transcript.filter((msg) => msg.role === "assistant").length;
  const isCheckpointTurn = mskCheckpointAssistantCounts.has(assistantQuestionsAsked);
  const progress = getMskDiagramProgress(args.chiefComplaint, args.transcript);
  const shouldForce =
    progress.isMskComplaint &&
    !args.forceSummary &&
    isCheckpointTurn &&
    progress.remainingParts.length > 0;
  if (!shouldForce) return args.turn;

  const deferredIntentHint = extractDeferredIntentHint(args.turn);
  const forcedQuestion = buildForcedLocationQuestion(args.languageCode, progress.remainingPartNames);
  return {
    type: "question",
    question: forcedQuestion,
    rationale:
      "Collect exact pain location for every injured body part using the body diagram to improve localization and triage.",
    requiresLocationMarking: true,
    deferredIntentHint: deferredIntentHint ?? undefined,
  };
}
