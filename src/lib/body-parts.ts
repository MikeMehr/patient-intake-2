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
  | "lower_leg"
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
  const hasBackRecurrencePhrasing =
    /\b(come|comes|coming|came)\s+back\b/.test(lowerText) ||
    /\b(back)\s+(again)\b/.test(lowerText);
  const hasExplicitBackAnatomyContext =
    /\b(my|the|your|his|her|their)\s+back\b/.test(lowerText) ||
    /\bback\s+(pain|ache|aches|aching|hurt|hurts|hurting|injury|injured|spasm|stiff|stiffness|sore)\b/.test(
      lowerText,
    ) ||
    /\b(pain|ache|aches|aching|hurt|hurts|hurting|injury|injured|spasm|stiff|stiffness|sore)\s+(in|at|of)\s+(my|the|your|his|her|their)?\s*back\b/.test(
      lowerText,
    );
  const hasAnteriorNeckPhrasing = /\b(anterior\s+neck|front\s+of\s+neck)\b/.test(lowerText);
  const hasThyroidPhrasing = /\bthyroid\b/.test(lowerText);
  const hasBackOfJointPhrasing =
    /\bback\s+of\s+(the\s+)?(knee|knees|elbow|elbows|shoulder|shoulders|hip|hips|ankle|ankles|wrist|wrists|neck)\b/.test(
      lowerText,
    ) ||
    /\bbehind\s+(the\s+)?(knee|knees|elbow|elbows|shoulder|shoulders|hip|hips|ankle|ankles|wrist|wrists|neck)\b/.test(
      lowerText,
    );

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

  // Elbow (include forearm phrasing)
  if (lowerText.match(/\b(elbow|elbows|forearm|forearms)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "elbow", name: "elbow", side });
  }

  // Shoulder
  if (lowerText.match(/\b(shoulder|shoulders)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "shoulder", name: "shoulder", side });
  }

  // Neck: include anterior/front neck so MSK neck flows can force neck diagram on Q2.
  // Chest mapping below still allows trunk-front context when needed.
  if (lowerText.match(/\b(neck|thyroid)\b/)) {
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
  if (
    lowerText.match(/\b(back)\b/) &&
    !lowerText.includes("lower") &&
    !lowerText.includes("upper") &&
    !hasBackOfJointPhrasing &&
    (!hasBackRecurrencePhrasing || hasExplicitBackAnatomyContext)
  ) {
    detected.push({ part: "back", name: "back" });
  }

  // Knee
  if (lowerText.match(/\b(knee|knees)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "knee", name: "knee", side });
  }

  // Lower leg
  if (lowerText.match(/\b(lower\s+leg|shin|shins|calf|calves)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "lower_leg", name: "lower leg", side });
  }

  // Ankle
  if (lowerText.match(/\b(ankle|ankles)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "ankle", name: "ankle", side });
  }

  // Foot (include common sole/heel descriptors)
  if (lowerText.match(/\b(foot|feet|heel|heels|sole|plantar|arch)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "foot", name: "foot", side });
  }

  // Hip (include upper-leg phrasing)
  if (lowerText.match(/\b(hip|hips|upper\s+leg|upper\s+thigh|thigh|thighs)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    detected.push({ part: "hip", name: "hip", side });
  }

  // Head (include scalp/face phrasing)
  if (lowerText.match(/\b(head|headache|headaches|scalp|face|facial)\b/)) {
    detected.push({ part: "head", name: "head" });
  }

  // Jaw / TMJ (map to head diagram)
  if (lowerText.match(/\b(jaw|jawbone|tmj|mandible)\b/)) {
    if (!detected.some((d) => d.part === "head")) {
      detected.push({ part: "head", name: "head" });
    }
  }

  // Ear / eye / temple / forehead (map to head diagram)
  if (lowerText.match(/\b(ear|ears|eardrum|earache|eye|eyes|eyelid|temple|temples|forehead)\b/)) {
    if (!detected.some((d) => d.part === "head")) {
      detected.push({ part: "head", name: "head" });
    }
  }

  // Chest (include breast and anterior-neck phrasing for trunk-front diagram)
  if (
    lowerText.match(/\b(chest|breast|breasts|breastbone|sternum)\b/) ||
    hasAnteriorNeckPhrasing
  ) {
    detected.push({ part: "chest", name: "chest" });
  }

  // Ribs / ribcage (map to chest diagram)
  if (lowerText.match(/\b(rib|ribs|ribcage|rib\s*cage|costal)\b/)) {
    if (!detected.some((d) => d.part === "chest")) {
      detected.push({ part: "chest", name: "chest" });
    }
  }

  // Abdomen
  if (lowerText.match(/\b(abdomen|abdominal|stomach|belly)\b/)) {
    detected.push({ part: "abdomen", name: "abdomen" });
  }

  // Pelvis / pelvic (map to abdomen — often GI/GYN in context)
  if (lowerText.match(/\b(pelvis|pelvic|pubic)\b/)) {
    if (!detected.some((d) => d.part === "abdomen")) {
      detected.push({ part: "abdomen", name: "abdomen" });
    }
  }

  // Groin / buttock / glute (map to hip diagram)
  if (lowerText.match(/\b(groin|buttock|buttocks|glute|glutes|gluteal)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    if (!detected.some((d) => d.part === "hip")) {
      detected.push({ part: "hip", name: "hip", side });
    }
  }

  // Finger / thumb / knuckle (map to hand diagram)
  if (lowerText.match(/\b(finger|fingers|thumb|thumbs|knuckle|knuckles|fingertip|fingertips)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    if (!detected.some((d) => d.part === "hand" || d.part === "wrist")) {
      detected.push({ part: "hand", name: "hand", side });
    }
  }

  // Armpit / axilla (map to shoulder diagram)
  if (lowerText.match(/\b(armpit|armpits|axilla|axillae)\b/)) {
    const side = lowerText.includes("right") ? "right" : lowerText.includes("left") ? "left" : undefined;
    if (!detected.some((d) => d.part === "shoulder")) {
      detected.push({ part: "shoulder", name: "shoulder", side });
    }
  }

  // Tailbone / sacrum (map to lower_back diagram)
  if (lowerText.match(/\b(tailbone|coccyx|sacrum|sacral)\b/)) {
    if (!detected.some((d) => d.part === "lower_back")) {
      detected.push({ part: "lower_back", name: "lower back" });
    }
  }

  // Spine / disc / vertebra — generic (map to back; lumbar/thoracic already caught above)
  if (lowerText.match(/\b(spine|spinal|vertebra|vertebrae|disc|discs)\b/)) {
    if (!detected.some((d) => d.part === "back" || d.part === "lower_back" || d.part === "upper_back")) {
      detected.push({ part: "back", name: "back" });
    }
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





















