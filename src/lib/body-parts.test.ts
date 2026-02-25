import { describe, expect, it } from "vitest";
import { detectBodyParts } from "./body-parts";

describe("detectBodyParts", () => {
  it("maps heel and sole phrasing to foot", () => {
    expect(detectBodyParts("left heel pain").some((part) => part.part === "foot")).toBe(true);
    expect(detectBodyParts("pain in left sole").some((part) => part.part === "foot")).toBe(true);
    expect(detectBodyParts("left plantar pain").some((part) => part.part === "foot")).toBe(true);
  });

  it("preserves side mapping for heel/sole phrases", () => {
    const leftHeel = detectBodyParts("left heel pain");
    const rightSole = detectBodyParts("right sole pain");

    expect(leftHeel.find((part) => part.part === "foot")?.side).toBe("left");
    expect(rightSole.find((part) => part.part === "foot")?.side).toBe("right");
  });
});
