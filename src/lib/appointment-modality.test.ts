import { describe, expect, it } from "vitest";
import { normalizeModality, resolveEffectiveModality } from "./appointment-modality";

describe("normalizeModality", () => {
  it("passes the three known values through", () => {
    expect(normalizeModality("PHONE")).toBe("PHONE");
    expect(normalizeModality("VIDEO")).toBe("VIDEO");
    expect(normalizeModality("IN_PERSON")).toBe("IN_PERSON");
  });

  it("falls back to PHONE for anything else", () => {
    expect(normalizeModality("video")).toBe("PHONE");
    expect(normalizeModality(null)).toBe("PHONE");
    expect(normalizeModality(undefined)).toBe("PHONE");
    expect(normalizeModality({})).toBe("PHONE");
  });
});

describe("resolveEffectiveModality", () => {
  it("lets the appointment override the clinic default", () => {
    expect(resolveEffectiveModality("VIDEO", "PHONE")).toBe("VIDEO");
    expect(resolveEffectiveModality("PHONE", "VIDEO")).toBe("PHONE");
  });

  it("falls back to the clinic setting when the appointment says nothing", () => {
    // Every row booked before migration 067 has NULL here, and so does every booking at a
    // clinic that doesn't let patients choose. Those must keep behaving exactly as they did
    // when the clinic setting was the only source of truth.
    expect(resolveEffectiveModality(null, "VIDEO")).toBe("VIDEO");
    expect(resolveEffectiveModality(undefined, "IN_PERSON")).toBe("IN_PERSON");
  });

  it("falls back to PHONE when neither is set", () => {
    expect(resolveEffectiveModality(null, null)).toBe("PHONE");
  });

  it("ignores a junk appointment value rather than trusting it", () => {
    expect(resolveEffectiveModality("TELEPATHY", "VIDEO")).toBe("VIDEO");
  });
});
