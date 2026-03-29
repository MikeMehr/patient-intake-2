import type { BodyPart } from "@/lib/body-parts";

export type BodyDiagramSex = "female" | "male";

/**
 * Returns a prompt-friendly description of available body part diagrams for the LLM.
 * Used in the interview prompt so the LLM knows diagrams exist and can ask patients to mark pain location.
 */
export function getBodyDiagramPromptSection(sex?: BodyDiagramSex): string {
  const chestDiagram =
    sex === "male"
      ? "/Images/Male Breast.png"
      : sex === "female"
        ? "/Images/Female Breast.png"
        : "/Images/trunk front .png (or Male/Female Breast.png based on patient sex)";

  return `BODY PART DIAGRAMS (available for patient to mark symptom or finding location):
- Knee: /Images/knee.png
- Lower leg: /Images/lower leg.png
- Ankle, foot: /Images/ankle.png, /Images/foot.png, /Images/Sole.png
- Hip, upper leg: /Images/Hip Upper Leg.png
- Shoulder: /Images/Shoulder.png
- Elbow, forearm: /Images/Forearm Elbow.png
- Hand, wrist: /Images/Hand Wrist.png
- Neck, head, face: /Images/Head Face Neck.png
- Back (thoracic/lumbar): /Images/Thoracic Lumbar Spine.png
- Chest: ${chestDiagram}
- Abdomen: /Images/trunk front .png

You may ask the patient to mark the location of their symptom or finding (pain, lump, mass, swelling, rash, tenderness, discharge source, or any localized complaint) on the relevant diagram when clinically appropriate. When you do, your question should mention the diagram/photo and ask them to mark where it is. Set "requiresLocationMarking": true when the question asks for diagram marking.
CRITICAL: Whenever "requiresLocationMarking" is true, you MUST also set "locationBodyParts" to a NON-EMPTY array. If "locationBodyParts" is missing or empty while "requiresLocationMarking" is true, the diagram will NOT appear for the patient. Valid keys ONLY: knee, lower_leg, ankle, foot, hip, shoulder, elbow, hand, wrist, neck, head, back, upper_back, lower_back, chest, abdomen. Key aliases: use "hand" for fingers/thumb/knuckles, "chest" for ribs/ribcage, "back" for spine/disc/vertebra (or lower_back/upper_back if location known), "lower_back" for tailbone/coccyx/sacrum, "head" for jaw/TMJ/ear/eye/temple, "hip" for groin/buttock/glute, "abdomen" for pelvis/pelvic, "shoulder" for armpit/axilla. Do NOT invent keys like "bone", "skeleton", "joint", "rib", "spine", "finger", or any other key not in the valid list.
IMPORTANT: Do NOT use the body diagram for diffuse or unknown locations (e.g. "bone pain", "generalized pain", "all over pain"). For those, ask which specific area/body part hurts using a plain text question first. Only use the diagram once you know the specific region.
Example for elbow pain: { "requiresLocationMarking": true, "locationBodyParts": ["elbow"] }
Example for chest pain: { "requiresLocationMarking": true, "locationBodyParts": ["chest"] }`;
}

export function getBodyDiagramImage(
  bodyPart: BodyPart,
  side?: "left" | "right",
  sex?: BodyDiagramSex,
): { src: string; alt: string } {
  if (bodyPart === "foot" && side === "left") {
    return {
      src: "/Images/Sole.png",
      alt: "Left sole pain diagram",
    };
  }

  switch (bodyPart) {
    case "foot":
      return {
        src: "/Images/foot.png",
        alt: "Foot pain diagram",
      };
    case "wrist":
    case "hand":
      return {
        src: "/Images/Hand Wrist.png",
        alt: "Hand, fingers, and wrist pain diagram",
      };
    case "elbow":
      return {
        src: "/Images/Forearm Elbow.png",
        alt: "Forearm and elbow pain diagram",
      };
    case "knee":
      return {
        src: "/Images/knee.png",
        alt: "Knee pain diagram",
      };
    case "lower_leg":
      return {
        src: "/Images/lower leg.png",
        alt: "Lower leg pain diagram",
      };
    case "ankle":
      return {
        src: "/Images/ankle.png",
        alt: "Ankle pain diagram",
      };
    case "shoulder":
      return {
        src: "/Images/Shoulder.png",
        alt: "Shoulder pain diagram",
      };
    case "head":
    case "neck":
      return {
        src: "/Images/Head Face Neck.png",
        alt: "Head, face, scalp, neck, and thyroid pain diagram",
      };
    case "hip":
      return {
        src: "/Images/Hip Upper Leg.png",
        alt: "Hip and upper leg pain diagram",
      };
    case "back":
    case "upper_back":
    case "lower_back":
      return {
        src: "/Images/Thoracic Lumbar Spine.png",
        alt: "Thoracic and lumbar spine pain diagram",
      };
    case "chest":
      if (sex === "male") {
        return {
          src: "/Images/Male Breast.png",
          alt: "Male chest and breast pain diagram",
        };
      }
      if (sex === "female") {
        return {
          src: "/Images/Female Breast.png",
          alt: "Female chest and breast pain diagram",
        };
      }
      return {
        src: "/Images/trunk front .png",
        alt: "Chest, breast, abdomen, and anterior neck pain diagram",
      };
    case "abdomen":
      return {
        src: "/Images/trunk front .png",
        alt: "Chest, breast, abdomen, and anterior neck pain diagram",
      };
    default:
      return {
        src: "/Images/ankle.png",
        alt: "Body part pain diagram",
      };
  }
}
