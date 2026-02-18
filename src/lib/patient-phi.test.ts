import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  computeHinHash,
  decryptPatientPhiString,
  encryptPatientPhiString,
  maskHin,
  normalizeHin,
} from "@/lib/patient-phi";

describe("patient-phi", () => {
  const originalEncKey = process.env.PATIENT_PHI_ENCRYPTION_KEY;
  const originalPepper = process.env.PATIENT_HIN_HASH_PEPPER;

  beforeEach(() => {
    // 32 bytes base64
    process.env.PATIENT_PHI_ENCRYPTION_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
    process.env.PATIENT_HIN_HASH_PEPPER = "test-pepper";
  });

  afterEach(() => {
    process.env.PATIENT_PHI_ENCRYPTION_KEY = originalEncKey;
    process.env.PATIENT_HIN_HASH_PEPPER = originalPepper;
  });

  it("normalizes HIN consistently", () => {
    expect(normalizeHin("  ab-12 34 ")).toBe("AB1234");
    expect(normalizeHin("AB1234")).toBe("AB1234");
  });

  it("hashes normalized HIN with pepper", () => {
    const a = computeHinHash("ab-12 34");
    const b = computeHinHash("AB1234");
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it("encrypts and decrypts PHI payloads", () => {
    const plaintext = "AB1234";
    const enc = encryptPatientPhiString(plaintext);
    const dec = decryptPatientPhiString(enc);
    expect(dec).toBe(plaintext);
  });

  it("masks HIN for display", () => {
    expect(maskHin("AB-12 34", 2)).toBe("****34");
  });
});

