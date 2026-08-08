import { describe, it, expect } from "vitest";
import { describeMspEligibility } from "@/lib/billing/msp-eligibility";

// A PHN that passes the BC check digit (mod 11 over digits 2..9), and the same number with the
// last digit bumped so it fails. Both are synthetic.
const VALID_BC_PHN = "9999999998";
const BAD_CHECKDIGIT = "9999999997";

describe("describeMspEligibility", () => {
  it("reports eligible for a BC PHN that passes its check digit", () => {
    expect(
      describeMspEligibility({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "British Columbia",
        healthCardNumber: VALID_BC_PHN,
      }),
    ).toBe("eligible");
  });

  it("accepts the 2-letter province code as well as the full name", () => {
    expect(
      describeMspEligibility({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "BC",
        healthCardNumber: VALID_BC_PHN,
      }),
    ).toBe("eligible");
  });

  it("tolerates the spaces and dashes patients type", () => {
    expect(
      describeMspEligibility({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "British Columbia",
        healthCardNumber: " 9999 999 998 ",
      }),
    ).toBe("eligible");
  });

  it("never claims eligible when the check digit fails", () => {
    const label = describeMspEligibility({
      coverageType: "CANADIAN_HEALTH_CARD",
      province: "British Columbia",
      healthCardNumber: BAD_CHECKDIGIT,
    });
    expect(label).toContain("unverified");
    expect(label).not.toContain("eligible");
  });

  it("flags an out-of-province card rather than calling it eligible", () => {
    expect(
      describeMspEligibility({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "Ontario",
        healthCardNumber: "1234567893",
      }),
    ).toBe("out of province (ON)");
  });

  it("does not fall back to BC when the province is missing", () => {
    expect(
      describeMspEligibility({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "",
        healthCardNumber: VALID_BC_PHN,
      }),
    ).toBe("unverified - province not stated");
  });

  it("says so when the clinic did not require a card number", () => {
    expect(
      describeMspEligibility({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "British Columbia",
        healthCardNumber: null,
      }),
    ).toBe("card not provided");
  });

  it.each([
    ["PRIVATE_PAY", "no - private pay"],
    ["TRAVEL_INSURANCE", "no - travel insurance"],
    ["UNINSURED", "no - uninsured"],
    ["EXISTING_OSCAR_PATIENT", "see chart"],
  ])("summarizes coverage type %s", (coverageType, expected) => {
    expect(describeMspEligibility({ coverageType })).toBe(expected);
  });

  it("returns a label for an unrecognized coverage type instead of throwing", () => {
    expect(describeMspEligibility({ coverageType: "SOMETHING_NEW" })).toBe("unknown");
  });

  it("keeps every label plain ASCII so the SMS stays GSM-7", () => {
    // One non-GSM-7 character (an em dash from checkHealthCard's reasons) re-encodes the whole
    // message as UCS-2 and drops the segment size from 160 to 70.
    const labels = [
      describeMspEligibility({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "British Columbia",
        // Letters in a BC PHN — the reason for this one carries an em dash.
        healthCardNumber: "9999999AB8",
      }),
      describeMspEligibility({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "British Columbia",
        healthCardNumber: BAD_CHECKDIGIT,
      }),
      describeMspEligibility({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "British Columbia",
        healthCardNumber: "99999",
      }),
      describeMspEligibility({ coverageType: "PRIVATE_PAY" }),
    ];
    for (const label of labels) {
      expect(label).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  it("never leaks the card number into the label", () => {
    for (const card of [VALID_BC_PHN, BAD_CHECKDIGIT]) {
      const label = describeMspEligibility({
        coverageType: "CANADIAN_HEALTH_CARD",
        province: "British Columbia",
        healthCardNumber: card,
      });
      expect(label).not.toContain(card);
    }
  });
});
