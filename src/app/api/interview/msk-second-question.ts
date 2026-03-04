import { detectBodyParts, getPrimaryBodyPart } from "@/lib/body-parts";
import type { InterviewMessage, InterviewResponse } from "@/lib/interview-schema";
import { hasLocationQuestionIntent } from "./location-signals";

const mskBodyPartSet = new Set([
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

const forcedLocationQuestionByLanguage: Record<string, string> = {
  en: "Looking at the diagram/photo of your {bodyPart}, please mark exactly where the pain is most noticeable.",
  es: "Mirando el diagrama/foto de su {bodyPart}, por favor marque exactamente dónde nota más dolor.",
  fr: "En regardant le schéma/photo de votre {bodyPart}, veuillez marquer exactement où la douleur est la plus marquée.",
  de: "Bitte markieren Sie im Diagramm/Foto Ihrer {bodyPart} genau die Stelle, an der der Schmerz am stärksten ist.",
  it: "Guardando il diagramma/foto del/la {bodyPart}, indichi esattamente dove il dolore è più evidente.",
  pt: "Olhando para o diagrama/foto do(a) seu(sua) {bodyPart}, marque exatamente onde a dor é mais intensa.",
  zh: "请查看您{bodyPart}的示意图/照片，并准确标记疼痛最明显的位置。",
  ja: "{bodyPart}の図/写真を見て、痛みが最も強い場所を正確にマークしてください。",
  ko: "{bodyPart}의 도표/사진을 보고 통증이 가장 뚜렷한 위치를 정확히 표시해 주세요.",
  ar: "بالنظر إلى المخطط/الصورة الخاصة بـ {bodyPart}، يرجى تحديد المكان الذي يكون فيه الألم أشد ما يمكن.",
  hi: "अपने {bodyPart} के डायग्राम/फोटो को देखकर कृपया ठीक उस जगह को चिन्हित करें जहां दर्द सबसे अधिक है।",
  fa: "با نگاه کردن به نمودار/عکس {bodyPart}، لطفاً دقیقاً محل بیشترین درد را علامت بزنید.",
};

function getMskContext(chiefComplaint: string) {
  const detected = detectBodyParts(chiefComplaint);
  const isMskComplaint = detected.some((bp) => mskBodyPartSet.has(bp.part));
  const primary = getPrimaryBodyPart(detected);
  return {
    isMskComplaint,
    mskBodyPartName: primary?.name || "affected area",
  };
}

function buildForcedLocationQuestion(languageCode: string, bodyPartName: string): string {
  const template =
    forcedLocationQuestionByLanguage[languageCode] ?? forcedLocationQuestionByLanguage.en;
  return template.replace("{bodyPart}", bodyPartName);
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
  const isSecondQuestionTurn = assistantQuestionsAsked === 1;
  const { isMskComplaint, mskBodyPartName } = getMskContext(args.chiefComplaint);
  const shouldForce = isMskComplaint && !args.forceSummary && isSecondQuestionTurn;
  if (!shouldForce) return args.turn;

  const deferredIntentHint = extractDeferredIntentHint(args.turn);
  const forcedQuestion = buildForcedLocationQuestion(args.languageCode, mskBodyPartName);
  return {
    type: "question",
    question: forcedQuestion,
    rationale: "Collect exact pain location using the body diagram to improve localization and triage.",
    requiresLocationMarking: true,
    deferredIntentHint: deferredIntentHint ?? undefined,
  };
}
