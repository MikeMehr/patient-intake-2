import { describe, it, expect } from "vitest";
import { describeMspEligibility } from "@/lib/billing/msp-eligibility";

// A PHN that passes the BC check digit (mod 11 over digits 2..9), and the same number with the
// last digit bumped so it fails. Both are synthetic.
const VALID_BC_PHN = "9999999998";
const BAD_CHECKDIGIT = "9999999997";
// A synthetic Ontario number that passes the Luhn check the province uses.
const VALID_ON_HIN = "1234567897";

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

  describe("returning patient, card read off the OSCAR chart", () => {
    it("reports eligible when the chart carries a BC PHN that passes its check digit", () => {
      expect(
        describeMspEligibility({
          coverageType: "EXISTING_OSCAR_PATIENT",
          chartCard: { hin: VALID_BC_PHN, hcType: "BC" },
        }),
      ).toBe("eligible (chart)");
    });

    it("reads a blank hc_type as BC, the way billing does", () => {
      // Most charts on this box carry no hc_type at all. Treating that as "other province" here
      // would report every one of them as unbillable.
      expect(
        describeMspEligibility({
          coverageType: "EXISTING_OSCAR_PATIENT",
          chartCard: { hin: VALID_BC_PHN, hcType: null },
        }),
      ).toBe("eligible (chart)");
    });

    it("says the chart has no card rather than claiming eligible", () => {
      const label = describeMspEligibility({
        coverageType: "EXISTING_OSCAR_PATIENT",
        chartCard: { hin: null, hcType: "BC" },
      });
      expect(label).toBe("No health card number on the chart");
      expect(label).not.toContain("eligible");
    });

    it("never claims eligible for a chart PHN that fails its check digit", () => {
      const label = describeMspEligibility({
        coverageType: "EXISTING_OSCAR_PATIENT",
        chartCard: { hin: BAD_CHECKDIGIT, hcType: "BC" },
      });
      expect(label).toContain("check digit");
      expect(label).not.toContain("eligible");
    });

    it("flags an out-of-province chart card", () => {
      const label = describeMspEligibility({
        coverageType: "EXISTING_OSCAR_PATIENT",
        // Passes the Ontario Luhn check, so the verdict turns on the province and not the digits.
        chartCard: { hin: VALID_ON_HIN, hcType: "ON" },
      });
      expect(label).toContain("out of province");
      expect(label).not.toContain("eligible");
    });

    it("falls back to see chart when the chart could not be read at all", () => {
      // Null means OSCAR was unreachable or not connected — not the same as a chart with no card,
      // and it must not be reported as one.
      expect(
        describeMspEligibility({ coverageType: "EXISTING_OSCAR_PATIENT", chartCard: null }),
      ).toBe("see chart");
    });

    it("keeps the chart labels plain ASCII so the SMS stays GSM-7", () => {
      const labels = [
        describeMspEligibility({
          coverageType: "EXISTING_OSCAR_PATIENT",
          // Letters in a BC PHN, and an out-of-province card: both reasons carry an em dash.
          chartCard: { hin: "9999999AB8", hcType: "BC" },
        }),
        describeMspEligibility({
          coverageType: "EXISTING_OSCAR_PATIENT",
          chartCard: { hin: VALID_ON_HIN, hcType: "AB" },
        }),
        describeMspEligibility({
          coverageType: "EXISTING_OSCAR_PATIENT",
          chartCard: { hin: VALID_ON_HIN, hcType: "ON" },
        }),
      ];
      for (const label of labels) {
        expect(label).toMatch(/^[\x20-\x7E]+$/);
      }
    });

    it("never leaks the chart card number into the label", () => {
      for (const hin of [VALID_BC_PHN, BAD_CHECKDIGIT]) {
        const label = describeMspEligibility({
          coverageType: "EXISTING_OSCAR_PATIENT",
          chartCard: { hin, hcType: "BC" },
        });
        expect(label).not.toContain(hin);
      }
    });
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
