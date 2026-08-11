import { describe, expect, it } from "vitest";
import { parsePathwaysGlobalData, parseWaitTimeRank } from "./parse";

describe("parseWaitTimeRank", () => {
  it("ranks common PathwaysBC buckets in increasing order", () => {
    const buckets = [
      "Within one week",
      "1-2 weeks",
      "2-4 weeks",
      "1-2 months",
      "2-4 months",
      "4-6 months",
    ];
    const ranks = buckets.map((b) => parseWaitTimeRank(b));
    expect(ranks.every((r) => r !== null)).toBe(true);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
    }
  });

  it("returns null for empty or unparseable text", () => {
    expect(parseWaitTimeRank(null)).toBeNull();
    expect(parseWaitTimeRank(undefined)).toBeNull();
    expect(parseWaitTimeRank("Not accepting referrals")).toBeNull();
  });

  it("handles a bare 'N+ units' bucket", () => {
    expect(parseWaitTimeRank("12+ months")).toBe(360);
  });
});

describe("parsePathwaysGlobalData", () => {
  // Shape mirrors a real PathwaysBC export captured 2026-08-11 (Dr. Naveed Malek, Neurology,
  // Richmond), trimmed to the fields the parser reads.
  const fixture = {
    specializations: { "14": { name: "Neurology" } },
    cities: { "18": { name: "Richmond" } },
    specialists: {
      "12632": {
        id: 12632,
        name: "Naveed Malek",
        lastName: "Malek",
        honorific: "Dr.",
        cityIds: [18],
        specializationIds: [14],
        billingNumber: "Q5759",
        waittime: "1-2 months",
        acceptsReferralsViaFax: true,
        acceptsReferralsViaPhone: false,
        acceptsReferralsViaProvincialPlatform: false,
        isPracticing: true,
        referralIconKey: "green_check",
      },
      // malformed row — no lastName — should be skipped, not crash the batch
      "999": { id: 999, name: "Broken Row" },
      // suppressed by PathwaysBC itself — should be skipped
      "1000": {
        id: 1000,
        name: "Hidden Doc",
        lastName: "Doc",
        specializationIds: [14],
        hidden: true,
      },
    },
  };

  it("normalizes a specialist and resolves specialization/city lookups", () => {
    const rows = parsePathwaysGlobalData(fixture);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.pathwaysId).toBe(12632);
    expect(row.name).toBe("Naveed Malek");
    expect(row.specialization).toBe("Neurology");
    expect(row.city).toBe("Richmond");
    expect(row.billingNumber).toBe("Q5759");
    expect(row.waitTime).toBe("1-2 months");
    expect(row.waitTimeRank).not.toBeNull();
    expect(row.acceptsReferralsViaFax).toBe(true);
    expect(row.acceptsReferralsViaPhone).toBe(false);
  });

  it("falls back to 'Unspecified' when a specialization id doesn't resolve", () => {
    const rows = parsePathwaysGlobalData({
      specializations: {},
      cities: {},
      specialists: {
        "1": { id: 1, name: "A B", lastName: "B", specializationIds: [999] },
      },
    });
    expect(rows[0].specialization).toBe("Unspecified");
    expect(rows[0].city).toBeNull();
  });

  it("throws on a payload missing the specialists collection", () => {
    expect(() => parsePathwaysGlobalData({})).toThrow();
  });
});
