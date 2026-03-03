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

  it("maps scalp and face phrasing to head", () => {
    expect(detectBodyParts("pain on scalp").some((part) => part.part === "head")).toBe(true);
    expect(detectBodyParts("facial pain near cheek").some((part) => part.part === "head")).toBe(true);
  });

  it("maps thyroid phrasing to neck", () => {
    expect(detectBodyParts("pain around thyroid area").some((part) => part.part === "neck")).toBe(true);
  });

  it("maps hip and upper-leg phrasing to hip", () => {
    expect(detectBodyParts("left hip pain").some((part) => part.part === "hip")).toBe(true);
    expect(detectBodyParts("pain in right upper leg").some((part) => part.part === "hip")).toBe(true);
    expect(detectBodyParts("thigh ache after running").some((part) => part.part === "hip")).toBe(true);
  });

  it("maps breast and anterior-neck phrasing to chest", () => {
    expect(detectBodyParts("right breast pain").some((part) => part.part === "chest")).toBe(true);
    expect(detectBodyParts("pain at front of neck").some((part) => part.part === "chest")).toBe(true);
  });
});
