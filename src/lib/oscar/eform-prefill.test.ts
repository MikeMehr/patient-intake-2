import { describe, it, expect } from "vitest";
import {
  buildConsultationRequestUrl,
  buildEformAddUrl,
  buildRxUrl,
  clampFillSpec,
  encodeFillSpecParam,
  type FillSpec,
  type RxItem,
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

function rxItem(overrides: Partial<RxItem> = {}): RxItem {
  return { search: "naproxen", strength: "500 mg", sig: "1 tab PO BID PRN pain", quantity: "40", repeats: "0", ...overrides };
}

describe("clampFillSpec rx", () => {
  it("round-trips rx items and drops empty-search ones", () => {
    const { spec: clamped, truncated } = clampFillSpec(
      spec({ rx: [rxItem(), rxItem({ search: "  " })] }),
    );
    expect(clamped.rx).toEqual([rxItem()]);
    expect(truncated).toBe(true);
  });

  it("caps rx field lengths and item count", () => {
    const { spec: clamped, truncated } = clampFillSpec(
      spec({ rx: Array.from({ length: 12 }, (_, i) => rxItem({ search: `drug${i}`, sig: "x".repeat(400) })) }),
    );
    expect(truncated).toBe(true);
    expect(clamped.rx).toHaveLength(10);
    expect(clamped.rx![0].sig.length).toBeLessThanOrEqual(200);
  });

  it("pops trailing rx items to meet the URL budget but keeps the first", () => {
    const { spec: clamped, truncated } = clampFillSpec(
      spec({
        rx: Array.from({ length: 10 }, (_, i) =>
          rxItem({
            search: `drug${i}` + "n".repeat(74),
            strength: "5".repeat(40),
            sig: "s".repeat(200),
            quantity: "q".repeat(20),
          }),
        ),
      }),
    );
    expect(truncated).toBe(true);
    expect(JSON.stringify(clamped).length).toBeLessThanOrEqual(4000);
    expect(clamped.rx!.length).toBeGreaterThanOrEqual(1);
    expect(clamped.rx![0].search.startsWith("drug0")).toBe(true);
  });
});

describe("buildRxUrl", () => {
  it("targets choosePatient.do with empty providerNo, demographicNo and ha_prefill", () => {
    const s = spec({ fid: 0, rx: [rxItem()] });
    const url = new URL(buildRxUrl("https://oscar.example.ca", s));
    expect(url.pathname).toBe("/oscar/oscarRx/choosePatient.do");
    expect(url.searchParams.get("providerNo")).toBe("");
    expect(url.searchParams.get("demographicNo")).toBe("123");
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
