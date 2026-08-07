import { describe, it, expect } from "vitest";
import { checkHealthCard, isValidBcPhn, isValidOnHin, normalizeCard } from "@/lib/billing/health-card";

/**
 * All card numbers here are synthetic — generated from the check-digit algorithms, not taken from
 * any chart. The algorithms themselves were validated against the clinic's real data separately:
 * every PHN on an MSP-accepted claim passes, and the only failures were OSCAR's 0000000000
 * placeholder.
 */
const VALID_BC = ["9234567897", "9876543218", "9111111117", "9202501019"];
const VALID_ON = ["1234567897", "9876543217"];

describe("isValidBcPhn", () => {
  it.each(VALID_BC)("accepts %s", (phn) => {
    expect(isValidBcPhn(phn)).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidBcPhn("9234567898")).toBe(false);
  });

  it("rejects anything not starting with 9", () => {
    expect(isValidBcPhn("5234567897")).toBe(false);
  });

  it("rejects short and long numbers", () => {
    expect(isValidBcPhn("923456789")).toBe(false);
    expect(isValidBcPhn("92345678970")).toBe(false);
  });

  it("rejects OSCAR's placeholder", () => {
    expect(isValidBcPhn("0000000000")).toBe(false);
  });

  it("rejects letters", () => {
    expect(isValidBcPhn("923456789A")).toBe(false);
  });
});

describe("isValidOnHin", () => {
  it.each(VALID_ON)("accepts %s", (hin) => {
    expect(isValidOnHin(hin)).toBe(true);
  });

  it("rejects a wrong Luhn digit", () => {
    expect(isValidOnHin("1234567890")).toBe(false);
  });
});

describe("normalizeCard", () => {
  it("strips spaces and hyphens but keeps letters", () => {
    expect(normalizeCard(" 1234-567 897 xy ")).toBe("1234567897XY");
  });
});

describe("checkHealthCard — BC", () => {
  it("auto-bills a valid BC PHN", () => {
    const r = checkHealthCard(VALID_BC[0], "BC");
    expect(r).toMatchObject({ ok: true, claimHin: VALID_BC[0], versionCode: "", province: "BC" });
  });

  it("accepts a BC PHN typed with separators", () => {
    expect(checkHealthCard("9234 567-897", "BC").ok).toBe(true);
  });

  it("treats a blank hc_type as BC", () => {
    expect(checkHealthCard(VALID_BC[1], "").province).toBe("BC");
  });

  it("refuses a BC PHN with a bad check digit", () => {
    const r = checkHealthCard("9234567898", "BC");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/check digit/i);
  });

  // The important one: never reshape a BC number that has letters in it.
  it("refuses — and does not strip — letters on a BC card", () => {
    const r = checkHealthCard("9234567897AB", "BC");
    expect(r.ok).toBe(false);
    expect(r.claimHin).toBe("");
    expect(r.reason).toMatch(/letters/i);
  });

  it("refuses the placeholder", () => {
    const r = checkHealthCard("0000000000", "BC");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/No health card/i);
  });

  it("refuses a short PHN and says how short", () => {
    const r = checkHealthCard("92345678", "BC");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/8 digits/);
  });
});

describe("checkHealthCard — Ontario", () => {
  it("splits the version code off and keeps it", () => {
    const r = checkHealthCard(`${VALID_ON[0]}XY`, "ON");
    expect(r.claimHin).toBe(VALID_ON[0]);
    expect(r.versionCode).toBe("XY");
    expect(r.claimHin).toHaveLength(10); // billingmaster.phn is varchar(10)
  });

  it("handles a card with no version code", () => {
    const r = checkHealthCard(VALID_ON[0], "ON");
    expect(r.claimHin).toBe(VALID_ON[0]);
    expect(r.versionCode).toBe("");
  });

  // Requested behaviour: same fee code, same run — but never billed without a tick.
  it("never auto-bills, even when the number is valid", () => {
    expect(checkHealthCard(`${VALID_ON[0]}XY`, "ON").ok).toBe(false);
  });

  it("flags a failed Ontario check digit distinctly", () => {
    const r = checkHealthCard("1234567890XY", "ON");
    expect(r.reason).toMatch(/check digit/i);
  });

  it("refuses a malformed Ontario card", () => {
    const r = checkHealthCard("12345XY", "ON");
    expect(r.claimHin).toBe("");
    expect(r.reason).toMatch(/10 digits/);
  });
});

describe("checkHealthCard — other provinces", () => {
  it("prepares but never auto-bills", () => {
    const r = checkHealthCard("1234567890", "AB");
    expect(r).toMatchObject({ ok: false, province: "OTHER", claimHin: "1234567890" });
    expect(r.reason).toMatch(/out-of-province/i);
  });
});
