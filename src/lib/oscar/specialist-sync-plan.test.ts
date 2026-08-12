import { describe, expect, it } from "vitest";
import {
  buildAddSpecialistPayload,
  buildAnnotation,
  candidateHasRequiredContactInfo,
  deriveFirstName,
  matchOscarService,
  normalizeReferralNo,
} from "./specialist-sync-plan";
import type { OscarSyncCandidate } from "@/lib/pathways-directory";

describe("normalizeReferralNo", () => {
  it("pads a 5-digit number to 6", () => {
    expect(normalizeReferralNo("29328")).toBe("029328");
  });
  it("passes a 6-digit number through unchanged", () => {
    expect(normalizeReferralNo("669020")).toBe("669020");
  });
  it("blanks an alphanumeric MSP code rather than mangling it", () => {
    expect(normalizeReferralNo("Q5759")).toBe("");
  });
  it("blanks null/empty", () => {
    expect(normalizeReferralNo(null)).toBe("");
    expect(normalizeReferralNo("")).toBe("");
  });
  it("blanks a length OSCAR won't accept", () => {
    expect(normalizeReferralNo("123")).toBe("");
    expect(normalizeReferralNo("1234567")).toBe("");
  });
});

describe("deriveFirstName", () => {
  it("strips a simple last name off the end", () => {
    expect(deriveFirstName("Naveed Malek", "Malek")).toBe("Naveed");
  });
  it("handles a multi-word last name", () => {
    expect(deriveFirstName("Tara von Kleist", "von Kleist")).toBe("Tara");
  });
  it("falls back to the full name when the last name isn't a suffix", () => {
    expect(deriveFirstName("Naveed Malek", "Smith")).toBe("Naveed Malek");
  });

  // PathwaysBC appends the practice to some names; without stripping it the suffix match fails
  // and the whole string lands in OSCAR's first-name field (seen live in OSCAR record 1611).
  it("drops a trailing practice name before splitting", () => {
    expect(deriveFirstName("Golmehr Sajjady (Aspire Bariatric & Lifestyle Clinic)", "Sajjady")).toBe("Golmehr");
    expect(deriveFirstName("Arjun Sangha (Alta Health Clinic)", "Sangha")).toBe("Arjun");
    expect(deriveFirstName("Claire Campion Wright (New Branch Medical)", "Campion Wright")).toBe("Claire");
  });

  it("keeps a nickname in quotes, which is part of the name proper", () => {
    expect(deriveFirstName('"Gill" Gillian Lauder (myoA For Youth)', "Lauder")).toBe('"Gill" Gillian');
  });
});

describe("buildAnnotation", () => {
  it("links back to the PathwaysBC profile", () => {
    expect(buildAnnotation(12632)).toContain("https://pathwaysbc.ca/specialists/12632");
  });
});

describe("matchOscarService", () => {
  const services = [
    { id: "55", name: "Neurology" },
    { id: "118", name: "Neuro." },
    { id: "9", name: "Cardiology" },
  ];

  it("matches case-insensitively", () => {
    expect(matchOscarService("neurology", services)?.id).toBe("55");
  });
  it("does not fuzzy-match a near-duplicate", () => {
    expect(matchOscarService("Neuro", services)).toBeNull();
  });
  it("returns null when nothing matches", () => {
    expect(matchOscarService("Urology", services)).toBeNull();
  });
});

describe("candidateHasRequiredContactInfo", () => {
  const base: OscarSyncCandidate = {
    linkId: "link-1",
    bcSpecialistId: "spec-1",
    pathwaysId: 12632,
    name: "Naveed Malek",
    lastName: "Malek",
    honorific: "Dr.",
    specialization: "Neurology",
    city: "Richmond",
    billingNumber: "Q5759",
    requestedByProviderNo: "101",
    address: null,
    phone: null,
    fax: null,
    email: null,
  };

  it("is false with no cached contact info (the common case until the scraper exists)", () => {
    expect(candidateHasRequiredContactInfo(base)).toBe(false);
  });
  it("is false with only a phone", () => {
    expect(candidateHasRequiredContactInfo({ ...base, phone: "604-273-2502" })).toBe(false);
  });
  it("is false with only an address", () => {
    expect(candidateHasRequiredContactInfo({ ...base, address: "123 Main St" })).toBe(false);
  });
  it("is true once both are present — this is what OSCAR actually requires", () => {
    expect(candidateHasRequiredContactInfo({ ...base, phone: "604-273-2502", address: "123 Main St" })).toBe(true);
  });
});

describe("buildAddSpecialistPayload", () => {
  const candidate: OscarSyncCandidate = {
    linkId: "link-1",
    bcSpecialistId: "spec-1",
    pathwaysId: 12632,
    name: "Naveed Malek",
    lastName: "Malek",
    honorific: "Dr.",
    specialization: "Neurology",
    city: "Richmond",
    billingNumber: "Q5759",
    requestedByProviderNo: "101",
    address: "Terra Nova Brighouse Clinic - #709, 8119 Park Road, Richmond, British Columbia, V6Y 0M5",
    phone: "604-273-2502",
    fax: "604-394-2556",
    email: "brighouse@terranovamedical.ca",
  };

  it("builds the full field set OSCAR's AddSpecialist.jsp expects", () => {
    const payload = buildAddSpecialistPayload(candidate);
    expect(payload.firstName).toBe("Naveed");
    expect(payload.lastName).toBe("Malek");
    expect(payload.salutation).toBe("Dr.");
    expect(payload.specType).toBe("Neurology");
    expect(payload.referralNo).toBe(""); // alphanumeric billing number, left blank
    expect(payload.annotation).toContain("pathwaysbc.ca/specialists/12632");
    expect(payload.address).toContain("Terra Nova Brighouse Clinic");
    expect(payload.phone).toBe("604-273-2502");
    expect(payload.fax).toBe("604-394-2556");
    expect(payload.email).toBe("brighouse@terranovamedical.ca");
    expect(payload.institution).toBe("0");
    expect(payload.department).toBe("0");
    expect(payload.hideFromView).toBe("false");
    expect(payload.eformId).toBe("0");
    expect(payload.whichType).toBe("1");
    expect(payload.transType).toBe("Add Specialist");
  });

  it("drops an unrecognized honorific rather than submitting an invalid salutation", () => {
    const payload = buildAddSpecialistPayload({ ...candidate, honorific: "Prof." });
    expect(payload.salutation).toBe("");
  });

  it("submits blank contact fields when none are cached, rather than throwing", () => {
    const payload = buildAddSpecialistPayload({ ...candidate, address: null, phone: null, fax: null, email: null });
    expect(payload.address).toBe("");
    expect(payload.phone).toBe("");
    // Note: callers must check candidateHasRequiredContactInfo() first — OSCAR rejects this.
  });
});
