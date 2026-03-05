import type { BodyPart } from "@/lib/body-parts";

export function getBodyDiagramImage(
  bodyPart: BodyPart,
  side?: "left" | "right",
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
