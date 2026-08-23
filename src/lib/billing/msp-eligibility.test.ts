import { describe, it, expect, vi } from "vitest";
import { describeMspEligibility, describeMspEligibilityChecked } from "@/lib/billing/msp-eligibility";

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

describe("describeMspEligibilityChecked (live MSP E45 on top of the card check)", () => {
  const TYPED = {
    coverageType: "CANADIAN_HEALTH_CARD",
    province: "British Columbia",
    healthCardNumber: VALID_BC_PHN,
    dateOfBirth: "1996-03-15",
  };
  const CHART = {
    coverageType: "EXISTING_OSCAR_PATIENT",
    chartCard: { hin: VALID_BC_PHN, hcType: "BC" },
    dateOfBirth: "1996-03-15",
  };

  it("confirms with MSP rather than trusting the check digit", async () => {
    const probe = vi.fn(async () => ({ status: "ELIGIBLE" as const }));
    await expect(describeMspEligibilityChecked({ ...TYPED, checkCoverage: probe })).resolves.toBe(
      "eligible, MSP-confirmed",
    );
    // The probe gets the claim PHN (digits only) and the birthdate MSP verifies it against.
    expect(probe).toHaveBeenCalledWith({ phn: VALID_BC_PHN, dob: "1996-03-15" });
  });

  it("says NOT eligible when MSP answers ELIG_ON_DOS: NO for a checksum-valid card", async () => {
    // The Nathan Archer case: a real PHN, lapsed coverage. The old verdict said "eligible".
    const probe = vi.fn(async () => ({
      status: "NOT_ELIGIBLE" as const,
      coverageEndDate: null,
      coverageEndReason: null,
    }));
    await expect(describeMspEligibilityChecked({ ...TYPED, checkCoverage: probe })).resolves.toBe(
      "NOT eligible today (MSP)",
    );
  });

  it("carries MSP's coverage-end detail when present, folded to GSM-7 and capped", async () => {
    const probe = vi.fn(async () => ({
      status: "NOT_ELIGIBLE" as const,
      coverageEndDate: "20260131",
      coverageEndReason: "MOVED OUT OF PROVINCE — PERMANENTLY AND FOR A VERY LONG TIME INDEED",
    }));
    const label = await describeMspEligibilityChecked({ ...TYPED, checkCoverage: probe });
    expect(label).toContain("NOT eligible today (MSP)");
    expect(label).toContain("coverage ended 20260131");
    expect(label).toMatch(/^[\x20-\x7E]+$/);
    // Prefix (42 chars) plus the detail capped at 40 — bounded well inside one SMS segment.
    expect(label.length).toBeLessThanOrEqual(82);
  });

  it("keeps the chart tag on a chart-sourced card", async () => {
    const probe = vi.fn(async () => ({ status: "ELIGIBLE" as const }));
    await expect(describeMspEligibilityChecked({ ...CHART, checkCoverage: probe })).resolves.toBe(
      "eligible (chart), MSP-confirmed",
    );
    expect(probe).toHaveBeenCalledWith({ phn: VALID_BC_PHN, dob: "1996-03-15" });
  });

  it("downgrades to coverage-unverified when the probe cannot answer", async () => {
    const probe = vi.fn(async () => ({ status: "UNAVAILABLE" as const, detail: "bridge down" }));
    await expect(describeMspEligibilityChecked({ ...TYPED, checkCoverage: probe })).resolves.toBe(
      "card valid, coverage unverified",
    );
    await expect(describeMspEligibilityChecked({ ...CHART, checkCoverage: probe })).resolves.toBe(
      "card valid (chart), coverage unverified",
    );
  });

  it("never says plain eligible without MSP: no probe means coverage unverified", async () => {
    await expect(describeMspEligibilityChecked({ ...TYPED, checkCoverage: null })).resolves.toBe(
      "card valid, coverage unverified",
    );
  });

  it("skips the probe and stays unverified when the birthdate is missing or malformed", async () => {
    const probe = vi.fn(async () => ({ status: "ELIGIBLE" as const }));
    for (const dateOfBirth of [null, "", "1996/03/15"]) {
      await expect(
        describeMspEligibilityChecked({ ...TYPED, dateOfBirth, checkCoverage: probe }),
      ).resolves.toBe("card valid, coverage unverified");
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it("treats a probe that throws as unavailable, never as a verdict", async () => {
    const probe = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(describeMspEligibilityChecked({ ...TYPED, checkCoverage: probe })).resolves.toBe(
      "card valid, coverage unverified",
    );
  });

  it("passes non-eligible card verdicts through untouched and never calls the probe", async () => {
    const probe = vi.fn(async () => ({ status: "ELIGIBLE" as const }));
    const cases = [
      { input: { coverageType: "PRIVATE_PAY" }, expected: "no - private pay" },
      {
        input: {
          coverageType: "CANADIAN_HEALTH_CARD",
          province: "British Columbia",
          healthCardNumber: BAD_CHECKDIGIT,
          dateOfBirth: "1996-03-15",
        },
        expected: "unverified - BC PHN fails its check digit",
      },
      { input: { coverageType: "EXISTING_OSCAR_PATIENT", chartCard: null }, expected: "see chart" },
    ];
    for (const { input, expected } of cases) {
      await expect(describeMspEligibilityChecked({ ...input, checkCoverage: probe })).resolves.toBe(expected);
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it("never leaks the card number into the checked labels", async () => {
    for (const status of ["ELIGIBLE", "NOT_ELIGIBLE", "UNAVAILABLE"] as const) {
      const probe = async () =>
        status === "NOT_ELIGIBLE"
          ? { status, coverageEndDate: null, coverageEndReason: null }
          : status === "UNAVAILABLE"
            ? { status, detail: "x" }
            : { status };
      const label = await describeMspEligibilityChecked({ ...TYPED, checkCoverage: probe });
      expect(label).not.toContain(VALID_BC_PHN);
      expect(label).toMatch(/^[\x20-\x7E]+$/);
    }
  });
});
