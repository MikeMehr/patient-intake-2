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

  it("keeps thyroid mapped to neck with anterior-neck wording", () => {
    const parts = detectBodyParts("pain at the front of neck near the thyroid");
    expect(parts.some((part) => part.part === "neck")).toBe(true);
    expect(parts.some((part) => part.part === "chest")).toBe(true);
  });

  it("maps hip and upper-leg phrasing to hip", () => {
    expect(detectBodyParts("left hip pain").some((part) => part.part === "hip")).toBe(true);
    expect(detectBodyParts("pain in right upper leg").some((part) => part.part === "hip")).toBe(true);
    expect(detectBodyParts("thigh ache after running").some((part) => part.part === "hip")).toBe(true);
  });

  it("maps breast phrasing to chest and keeps anterior-neck mapped to neck+chest", () => {
    expect(detectBodyParts("right breast pain").some((part) => part.part === "chest")).toBe(true);
    const anteriorNeck = detectBodyParts("pain at front of neck");
    expect(anteriorNeck.some((part) => part.part === "chest")).toBe(true);
    expect(anteriorNeck.some((part) => part.part === "neck")).toBe(true);
  });

  it("maps forearm phrasing to elbow", () => {
    expect(detectBodyParts("left forearm pain").some((part) => part.part === "elbow")).toBe(true);
  });

  it("maps lower-leg phrasing to ankle", () => {
    expect(detectBodyParts("right lower leg pain").some((part) => part.part === "ankle")).toBe(true);
    expect(detectBodyParts("left calf pain").some((part) => part.part === "ankle")).toBe(true);
    expect(detectBodyParts("shin pain after running").some((part) => part.part === "ankle")).toBe(true);
  });

  it("does not treat back of the knee as a separate back complaint", () => {
    const parts = detectBodyParts("back of the knee pain");
    expect(parts.some((part) => part.part === "knee")).toBe(true);
    expect(parts.some((part) => part.part === "back")).toBe(false);
  });

  it("keeps explicit back complaints mapped to back", () => {
    const parts = detectBodyParts("my back hurts when I bend");
    expect(parts.some((part) => part.part === "back")).toBe(true);
  });

  it("keeps upper back complaints mapped to upper_back", () => {
    const parts = detectBodyParts("upper back pain after lifting");
    expect(parts.some((part) => part.part === "upper_back")).toBe(true);
  });
});
