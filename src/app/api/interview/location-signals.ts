const locationQuestionTopicPattern =
  /\b(location|which area|which part|pain location|site of pain|where does it hurt|where is the pain|where exactly is the pain)\b/;

const explicitLocationAnswerPattern =
  /\b(location|pain location|which area|which part|site of pain|where (?:it|the pain) hurts|(?:left|right)\s+(?:knee|ankle|foot|hip|shoulder|elbow|wrist|hand|arm|leg|back|neck))\b/;

export function hasLocationQuestionIntent(questionLower: string): boolean {
  return locationQuestionTopicPattern.test(questionLower);
}

export function hasLocationAnswerSignal(answerLower: string): boolean {
  if (explicitLocationAnswerPattern.test(answerLower)) {
    return true;
  }

  const hasMarkerAction = /\b(marked|mark|clicked|tapped|placed an x|placed x)\b/.test(answerLower);
  const hasMarkerTarget = /\b(diagram|photo|image|spot|area)\b/.test(answerLower);
  return hasMarkerAction && hasMarkerTarget;
}
