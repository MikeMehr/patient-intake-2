// Body part detection and diagram utilities

export type BodyPart = 
  | "wrist"
  | "hand"
  | "elbow"
  | "shoulder"
  | "neck"
  | "back"
  | "lower_back"
  | "upper_back"
  | "knee"
  | "ankle"
  | "foot"
  | "hip"
  | "head"
  | "chest"
  | "abdomen";

export interface BodyPartInfo {
  part: BodyPart;
  name: string;
  side?: "left" | "right" | "both";
}

/**
 * Detects body parts mentioned in text
 */
export function detectBodyParts(text: string): BodyPartInfo[] {
  const lowerText = text.toLowerCase();
  const detected: BodyPartInfo[] = [];

  // Wrist
  if (lowerText.match(/\b(wrist|wrists)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "wrist", name: "wrist", side });
  }

  // Hand
  if (lowerText.match(/\b(hand|hands)\b/) && !lowerText.includes("wrist")) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "hand", name: "hand", side });
  }

  // Elbow
  if (lowerText.match(/\b(elbow|elbows)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "elbow", name: "elbow", side });
  }

  // Shoulder
  if (lowerText.match(/\b(shoulder|shoulders)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "shoulder", name: "shoulder", side });
  }

  // Neck
  if (lowerText.match(/\b(neck)\b/)) {
    detected.push({ part: "neck", name: "neck" });
  }

  // Back (lower back)
  if (lowerText.match(/\b(lower\s+back|low\s+back|lumbar)\b/)) {
    detected.push({ part: "lower_back", name: "lower back" });
  }

  // Back (upper back)
  if (lowerText.match(/\b(upper\s+back|upper\s+spine|thoracic)\b/)) {
    detected.push({ part: "upper_back", name: "upper back" });
  }

  // Back (general)
  if (lowerText.match(/\b(back)\b/) && !lowerText.includes("lower") && !lowerText.includes("upper")) {
    detected.push({ part: "back", name: "back" });
  }

  // Knee
  if (lowerText.match(/\b(knee|knees)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "knee", name: "knee", side });
  }

  // Ankle
  if (lowerText.match(/\b(ankle|ankles)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "ankle", name: "ankle", side });
  }

  // Foot
  if (lowerText.match(/\b(foot|feet)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "foot", name: "foot", side });
  }

  // Hip
  if (lowerText.match(/\b(hip|hips)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "hip", name: "hip", side });
  }

  // Head
  if (lowerText.match(/\b(head|headache|headaches)\b/)) {
    detected.push({ part: "head", name: "head" });
  }

  // Chest
  if (lowerText.match(/\b(chest|breastbone|sternum)\b/)) {
    detected.push({ part: "chest", name: "chest" });
  }

  // Abdomen
  if (lowerText.match(/\b(abdomen|abdominal|stomach|belly)\b/)) {
    detected.push({ part: "abdomen", name: "abdomen" });
  }

  return detected;
}

/**
 * Gets the primary body part from a list (prioritizes specific over general)
 */
export function getPrimaryBodyPart(parts: BodyPartInfo[]): BodyPartInfo | null {
  if (parts.length === 0) return null;
  
  // Prioritize specific parts over general ones
  const specific = parts.find(p => p.part !== "back" && p.part !== "hand");
  return specific || parts[0];
}





















