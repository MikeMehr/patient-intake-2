import { describe, expect, it } from "vitest";
import {
  buildOscarNameIndex,
  computeReconciliationMatches,
  normalizeNameTokens,
  type DirectoryCandidate,
  type OscarRosterEntry,
} from "./specialist-reconcile";

describe("normalizeNameTokens", () => {
  it("strips a leading asterisk (real OSCAR data, e.g. lastName '*Jung')", () => {
    expect(normalizeNameTokens("*Jung Gordon")).toEqual(new Set(["jung", "gordon"]));
  });
  it("is order-independent", () => {
    expect(normalizeNameTokens("Jung Gordon")).toEqual(normalizeNameTokens("Gordon Jung"));
  });
});

describe("computeReconciliationMatches", () => {
  const roster: OscarRosterEntry[] = [
    {
      specId: "1604",
      displayName: "Malek Naveed",
      address: "Terra Nova Brighouse Clinic",
      phone: "604-273-2502",
      fax: "604-394-2556",
      serviceNames: ["Neurology"],
    },
    {
      specId: "514",
      displayName: "*Jung Gordon",
      address: "467 E. Columbia Street New Westminster",
      phone: "604-528-3961",
      fax: "604-528-3962",
      serviceNames: ["Dermatology"],
    },
    // Same name as a real candidate below, but wrong specialty — must NOT match.
    {
      specId: "999",
      displayName: "Priya Nagra",
      address: "Some Other Clinic",
      phone: "604-000-0000",
      fax: null,
      serviceNames: ["Cardiology"],
    },
    // Two different OSCAR entries share a name with no specialty overlap for either — ambiguous.
    {
      specId: "1001",
      displayName: "Sam Lee",
      address: "Clinic A",
      phone: "111",
      fax: null,
      serviceNames: ["Oncology"],
    },
    {
      specId: "1002",
      displayName: "Lee Sam",
      address: "Clinic B",
      phone: "222",
      fax: null,
      serviceNames: ["Oncology"],
    },
  ];
  const nameIndex = buildOscarNameIndex(roster);

  it("matches on exact name tokens + specialty overlap", () => {
    const candidates: DirectoryCandidate[] = [
      { bcSpecialistId: "bc-1", name: "Naveed Malek", specialization: "Neurology" },
    ];
    const matches = computeReconciliationMatches(candidates, nameIndex);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      bcSpecialistId: "bc-1",
      oscarSpecId: "1604",
      oscarServiceName: "Neurology",
      phone: "604-273-2502",
    });
  });

  it("matches despite a leading asterisk and reversed name order", () => {
    const candidates: DirectoryCandidate[] = [{ bcSpecialistId: "bc-2", name: "Gordon Jung", specialization: "Dermatology" }];
    const matches = computeReconciliationMatches(candidates, nameIndex);
    expect(matches).toHaveLength(1);
    expect(matches[0].oscarSpecId).toBe("514");
  });

  it("does NOT match when the name matches but the specialty doesn't (same-name, different person)", () => {
    const candidates: DirectoryCandidate[] = [{ bcSpecialistId: "bc-3", name: "Priya Nagra", specialization: "Neurology" }];
    expect(computeReconciliationMatches(candidates, nameIndex)).toHaveLength(0);
  });

  it("leaves it unlinked when the name has no OSCAR entry at all", () => {
    const candidates: DirectoryCandidate[] = [{ bcSpecialistId: "bc-4", name: "Nobody Here", specialization: "Neurology" }];
    expect(computeReconciliationMatches(candidates, nameIndex)).toHaveLength(0);
  });

  it("leaves it unlinked when two different OSCAR entries share the exact same name+specialty ambiguity", () => {
    // Both "Sam Lee" entries are under Oncology — deliberately construct a candidate that would
    // match both by name+specialty to exercise the ambiguous (skip) path.
    const ambiguousRoster: OscarRosterEntry[] = [
      { specId: "a", displayName: "Sam Lee", address: null, phone: null, fax: null, serviceNames: ["Oncology"] },
      { specId: "b", displayName: "Lee Sam", address: null, phone: null, fax: null, serviceNames: ["Oncology"] },
    ];
    const idx = buildOscarNameIndex(ambiguousRoster);
    const candidates: DirectoryCandidate[] = [{ bcSpecialistId: "bc-5", name: "Sam Lee", specialization: "Oncology" }];
    expect(computeReconciliationMatches(candidates, idx)).toHaveLength(0);
  });
});
