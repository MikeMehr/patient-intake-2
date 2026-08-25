import { describe, it, expect } from "vitest";
import {
  buildConsultationRequestUrl,
  buildEformAddUrl,
  clampFillSpec,
  encodeFillSpecParam,
  type FillSpec,
} from "./eform-prefill";

function spec(overrides: Partial<FillSpec> = {}): FillSpec {
  return {
    v: 1,
    fid: 7,
    demographicNo: "123",
    checks: ["Xray"],
    fields: { ExamRequestedText: "X-ray right knee" },
    ...overrides,
  };
}

// Mirrors the decoder in the injected eForm script (patch_eform_prefill.py).
function decodeParam(param: string): FillSpec {
  let b64 = param.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as FillSpec;
}

describe("encodeFillSpecParam", () => {
  it("round-trips through the eForm-side decoding", () => {
    const original = spec({ fields: { RelevantHistory: "pain × 9 days — no trauma" } });
    expect(decodeParam(encodeFillSpecParam(original))).toEqual(original);
  });

  it("is URL-safe (no +, /, or =)", () => {
    const param = encodeFillSpecParam(spec({ fields: { a: "?a=b&c=d/e+f" } }));
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("clampFillSpec", () => {
  it("passes small specs through untouched", () => {
    const { spec: clamped, truncated } = clampFillSpec(spec());
    expect(truncated).toBe(false);
    expect(clamped).toEqual(spec());
  });

  it("drops empty fields", () => {
    const { spec: clamped } = clampFillSpec(spec({ fields: { a: "  ", b: "keep" } }));
    expect(clamped.fields).toEqual({ b: "keep" });
  });

  it("clips over-long free-text fields and flags truncation", () => {
    const { spec: clamped, truncated } = clampFillSpec(
      spec({ fields: { RelevantHistory: "x".repeat(5000), subject: "y".repeat(500) } }),
    );
    expect(truncated).toBe(true);
    expect(clamped.fields.RelevantHistory.length).toBeLessThanOrEqual(700);
    expect(clamped.fields.subject.length).toBeLessThanOrEqual(160);
  });

  it("keeps the whole spec under the URL budget, preserving checks", () => {
    const big = spec({
      checks: Array.from({ length: 30 }, (_, i) => `Check${i}`),
      fields: {
        AdditionalTestInstructions: "a".repeat(3000),
        RelevantHistory: "b".repeat(3000),
        RelevantHistoryText: "c".repeat(3000),
        DiagnosisAndIndications: "d".repeat(3000),
      },
    });
    const { spec: clamped, truncated } = clampFillSpec(big);
    expect(truncated).toBe(true);
    expect(JSON.stringify(clamped).length).toBeLessThanOrEqual(4000);
    expect(clamped.checks).toEqual(big.checks);
  });
});

describe("clampFillSpec selects", () => {
  it("passes selects through, dropping empty values", () => {
    const { spec: clamped } = clampFillSpec(
      spec({ selects: { service: "Dermatology", urgency: "2", empty: "  " } }),
    );
    expect(clamped.selects).toEqual({ service: "Dermatology", urgency: "2" });
  });
});

describe("buildConsultationRequestUrl", () => {
  it("targets ConsultationFormRequest.jsp with de and ha_prefill", () => {
    const s = spec({ fid: 0, selects: { service: "Dermatology" } });
    const url = new URL(buildConsultationRequestUrl("https://oscar.example.ca", s));
    expect(url.pathname).toBe("/oscar/oscarEncounter/oscarConsultationRequest/ConsultationFormRequest.jsp");
    expect(url.searchParams.get("de")).toBe("123");
    expect(decodeParam(url.searchParams.get("ha_prefill") || "")).toEqual(s);
  });
});

describe("buildEformAddUrl", () => {
  it("targets efmformadd_data.jsp with fid, demographic_no and ha_prefill", () => {
    const url = new URL(buildEformAddUrl("https://oscar.example.ca", spec()));
    expect(url.origin).toBe("https://oscar.example.ca");
    expect(url.pathname).toBe("/oscar/eform/efmformadd_data.jsp");
    expect(url.searchParams.get("fid")).toBe("7");
    expect(url.searchParams.get("demographic_no")).toBe("123");
    expect(decodeParam(url.searchParams.get("ha_prefill") || "")).toEqual(spec());
  });
});
