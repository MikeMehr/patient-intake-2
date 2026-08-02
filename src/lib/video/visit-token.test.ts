import { beforeAll, describe, expect, it } from "vitest";
import { generateVisitToken, hashVisitToken, isVisitTokenShape } from "./visit-token";

describe("generateVisitToken", () => {
  it("produces a 64-hex raw token and stores only its hash", () => {
    const { raw, hash } = generateVisitToken(null);
    expect(raw).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(raw);
    expect(hashVisitToken(raw)).toBe(hash);
  });

  it("is unique per call", () => {
    const a = generateVisitToken(null);
    const b = generateVisitToken(null);
    expect(a.raw).not.toBe(b.raw);
  });

  it("expires a day after a scheduled visit ends", () => {
    const end = new Date("2026-08-05T17:20:00.000Z");
    const { expiresAt } = generateVisitToken(end);
    expect(expiresAt.toISOString()).toBe("2026-08-06T17:20:00.000Z");
  });

  it("gives an unscheduled visit a short life rather than an unbounded one", () => {
    // OSCAR-only rooms have no end time; without this branch the token would either never
    // expire or expire immediately.
    const { expiresAt } = generateVisitToken(null);
    const hours = (expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1);
    expect(hours).toBeLessThanOrEqual(12);
  });

  it("is much shorter-lived than the 30-day appointment manage token", () => {
    const { expiresAt } = generateVisitToken(new Date());
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeLessThan(2);
  });
});

describe("isVisitTokenShape", () => {
  it("accepts a well-formed token", () => {
    expect(isVisitTokenShape("a".repeat(64))).toBe(true);
  });

  it("rejects wrong lengths, uppercase, non-hex and non-strings", () => {
    expect(isVisitTokenShape("a".repeat(63))).toBe(false);
    expect(isVisitTokenShape("A".repeat(64))).toBe(false);
    expect(isVisitTokenShape("g".repeat(64))).toBe(false);
    expect(isVisitTokenShape(undefined)).toBe(false);
    expect(isVisitTokenShape(null)).toBe(false);
    expect(isVisitTokenShape(12345)).toBe(false);
  });
});

/**
 * Migration 068 stores the token encrypted *as well as* hashed, so a provider can re-send a
 * link for an appointment that never went through online booking. That only works if the
 * ciphertext round-trips back to a token whose hash still matches the lookup index — if those
 * two ever diverge, "send the link" silently mails a URL that resolves to nothing.
 */
describe("join token at rest", () => {
  beforeAll(() => {
    // Fixed 32-byte key so the test is deterministic and needs no local env.
    process.env.EMR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("round-trips through encryptString and still matches its hash", async () => {
    const { encryptString, decryptString } = await import("@/lib/encrypted-field");
    const { raw, hash } = generateVisitToken(null);

    const enc = encryptString(raw);
    expect(enc).not.toContain(raw); // ciphertext, not the token in disguise
    expect(decryptString(enc)).toBe(raw);
    expect(hashVisitToken(decryptString(enc))).toBe(hash);
  });

  it("produces different ciphertext each time, so the column leaks no equality", async () => {
    const { encryptString } = await import("@/lib/encrypted-field");
    const { raw } = generateVisitToken(null);
    expect(encryptString(raw)).not.toBe(encryptString(raw));
  });
});
