import type { BodyPart } from "@/lib/body-parts";

const locationQuestionTopicPattern =
  /\b(location|which area|which part|pain location|site of pain|where does it hurt|where is the pain|where exactly is the pain)\b/;

const explicitLocationAnswerPattern =
  /\b(location|pain location|which area|which part|site of pain|where (?:it|the pain) hurts|(?:left|right)\s+(?:knee|ankle|lower leg|foot|hip|shoulder|elbow|wrist|hand|arm|leg|back|neck))\b/;

const bodyPartMentionPattern: Record<BodyPart, RegExp> = {
  wrist: /\b(wrist|wrists)\b/,
  hand: /\b(hand|hands)\b/,
  elbow: /\b(elbow|elbows|forearm|forearms)\b/,
  shoulder: /\b(shoulder|shoulders)\b/,
  neck: /\b(neck|cervical)\b/,
  back: /\b(back)\b/,
  lower_back: /\b(lower\s+back|low\s+back|lumbar)\b/,
  upper_back: /\b(upper\s+back|thoracic)\b/,
  knee: /\b(knee|knees)\b/,
  lower_leg: /\b(lower\s+leg|shin|shins|calf|calves)\b/,
  ankle: /\b(ankle|ankles)\b/,
  foot: /\b(foot|feet|heel|heels|sole|plantar|arch)\b/,
  hip: /\b(hip|hips|upper\s+leg|upper\s+thigh|thigh|thighs)\b/,
  head: /\b(head|headache|headaches|scalp|face|facial)\b/,
  chest: /\b(chest|sternum|breastbone|anterior\s+chest)\b/,
  abdomen: /\b(abdomen|abdominal|stomach|belly)\b/,
};

export function hasLocationQuestionIntent(questionLower: string): boolean {
  return locationQuestionTopicPattern.test(questionLower);
}

export function hasMarkerSignal(answerLower: string): boolean {
  const hasEnglishMarkerAction =
    /\b(marked|mark|clicked|tapped|placed an x|placed x)\b/.test(answerLower);
  const hasEnglishMarkerTarget = /\b(diagram|photo|image|spot|area)\b/.test(answerLower);
  if (hasEnglishMarkerAction && hasEnglishMarkerTarget) {
    return true;
  }

  // Farsi marker support for localized diagram confirmations from the patient app.
  const hasFarsiMarkerAction = /(علامت|نشانه|کلیک|تپ)/u.test(answerLower);
  const hasFarsiMarkerTarget = /(نمودار|عکس|تصویر|محل|نقطه)/u.test(answerLower);
  return hasFarsiMarkerAction && hasFarsiMarkerTarget;
}

export function hasLocationAnswerSignal(answerLower: string): boolean {
  if (explicitLocationAnswerPattern.test(answerLower)) {
    return true;
  }

  return hasMarkerSignal(answerLower);
}

export function hasBodyPartLocationAnswerSignal(
  answerLower: string,
  bodyPart: BodyPart,
): boolean {
  const mentionsBodyPart = bodyPartMentionPattern[bodyPart]?.test(answerLower) ?? false;
  if (!mentionsBodyPart) {
    return false;
  }

  return hasMarkerSignal(answerLower);
}
