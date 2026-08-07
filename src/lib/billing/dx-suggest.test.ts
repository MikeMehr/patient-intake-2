import { describe, it, expect } from "vitest";
import {
  buildDxSchema,
  buildDxMessages,
  validateDxResponse,
  rankCandidates,
  NO_MATCH,
  MAX_CANDIDATES,
  type DxCandidate,
} from "@/lib/billing/dx-suggest";

const CANDIDATES: DxCandidate[] = [
  { code: "462", description: "ACUTE PHARYNGITIS" },
  { code: "781", description: "NERV/MUSCULSKEL SYS SYMP*" },
  { code: "786", description: "RESP SYS/OTH CHEST SYMP*" },
];

describe("buildDxSchema", () => {
  it("constrains code to the candidates plus NONE", () => {
    const schema = buildDxSchema(CANDIDATES);
    expect(schema.json_schema.schema.properties.code.enum).toEqual(["462", "781", "786", NO_MATCH]);
  });

  it("is strict, so the model cannot invent fields", () => {
    const schema = buildDxSchema(CANDIDATES);
    expect(schema.json_schema.strict).toBe(true);
    expect(schema.json_schema.schema.additionalProperties).toBe(false);
  });

  it("still offers NONE when there are no candidates", () => {
    expect(buildDxSchema([]).json_schema.schema.properties.code.enum).toEqual([NO_MATCH]);
  });
});

describe("buildDxMessages", () => {
  it("puts every candidate and the note in the user turn", () => {
    const [, user] = buildDxMessages("Sore throat x3d. Assessment: acute pharyngitis.", CANDIDATES);
    expect(user.content).toContain("462  ACUTE PHARYNGITIS");
    expect(user.content).toContain("acute pharyngitis");
  });

  it("instructs the model to answer NONE rather than guess", () => {
    const [system] = buildDxMessages("x", CANDIDATES);
    expect(String(system.content)).toMatch(/NONE rather than guessing/);
  });
});

describe("validateDxResponse", () => {
  it("accepts a well-formed on-list answer", () => {
    const r = validateDxResponse(
      { code: "462", confidence: "high", evidence: "acute pharyngitis" },
      CANDIDATES,
    );
    expect(r).toEqual({ code: "462", confidence: "high", evidence: "acute pharyngitis" });
  });

  // The point of the whole module: an off-list code must never reach a claim.
  it("rejects a code that is not on the list", () => {
    const r = validateDxResponse({ code: "250", confidence: "high", evidence: "diabetes" }, CANDIDATES);
    expect(r.code).toBe(NO_MATCH);
  });

  it("passes NONE straight through", () => {
    expect(validateDxResponse({ code: NO_MATCH, confidence: "low", evidence: "" }, CANDIDATES).code).toBe(
      NO_MATCH,
    );
  });

  it.each([null, undefined, "462", 42, {}, { code: "" }])("survives junk input: %s", (junk) => {
    expect(validateDxResponse(junk, CANDIDATES).code).toBe(NO_MATCH);
  });

  it("falls back to low confidence when the value is unrecognised", () => {
    const r = validateDxResponse({ code: "462", confidence: "certain", evidence: "x" }, CANDIDATES);
    expect(r.confidence).toBe("low");
  });

  it("trims an over-long evidence quote instead of losing the code", () => {
    const r = validateDxResponse(
      { code: "462", confidence: "high", evidence: "z".repeat(500) },
      CANDIDATES,
    );
    expect(r.code).toBe("462");
    expect(r.evidence).toHaveLength(200);
  });

  it("rejects everything when there are no candidates", () => {
    expect(validateDxResponse({ code: "462", confidence: "high", evidence: "" }, []).code).toBe(NO_MATCH);
  });
});

describe("rankCandidates", () => {
  it("puts the patient's own codes first, then clinic history, then keyword hits", () => {
    const out = rankCandidates({
      patientDx: [{ code: "250", description: "DIABETES" }],
      clinicHistory: [{ code: "462", description: "ACUTE PHARYNGITIS" }],
      keywordMatches: [{ code: "786", description: "RESP" }],
    });
    expect(out.map((c) => c.code)).toEqual(["250", "462", "786"]);
  });

  it("de-duplicates across the three sources", () => {
    const out = rankCandidates({
      patientDx: [{ code: "462", description: "ACUTE PHARYNGITIS" }],
      clinicHistory: [{ code: "462", description: "ACUTE PHARYNGITIS" }],
      keywordMatches: [{ code: "462", description: "ACUTE PHARYNGITIS" }],
    });
    expect(out).toHaveLength(1);
  });

  it("truncates to the cap", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ code: `X${i}`, description: "d" }));
    expect(rankCandidates({ patientDx: [], clinicHistory: [], keywordMatches: many })).toHaveLength(
      MAX_CANDIDATES,
    );
  });

  it("keeps the patient's own codes even when history would fill the cap", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ code: `X${i}`, description: "d" }));
    const out = rankCandidates({
      patientDx: [{ code: "250", description: "DIABETES" }],
      clinicHistory: many,
      keywordMatches: [],
    });
    expect(out[0].code).toBe("250");
  });
});
