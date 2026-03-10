import type { BodyPart, BodyPartInfo } from "@/lib/body-parts";
import { detectBodyParts } from "@/lib/body-parts";
import type { InterviewMessage } from "@/lib/interview-schema";
import { hasBodyPartLocationAnswerSignal } from "./location-signals";

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
  "lower_leg",
  "ankle",
  "foot",
  "hip",
]);

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
  lower_leg: /\b(lower\s+leg|shin|shins|calf|calves)\b/,
  ankle: /\b(ankle|ankles)\b/,
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

