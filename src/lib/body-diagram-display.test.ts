import { describe, expect, it } from "vitest";
import { mergeDiagramSelectionsForDisplay } from "./body-diagram-display";

describe("mergeDiagramSelectionsForDisplay", () => {
  it("keeps marker-backed selections first and appends selected-parts-only fallback", () => {
    const result = mergeDiagramSelectionsForDisplay({
      markerSelections: [
        { part: "neck", markers: [{ xPct: 44, yPct: 26 }] },
        { part: "foot", side: "left", markers: [{ xPct: 52, yPct: 71 }] },
      ],
      selectedParts: [
        { part: "neck" },
        { part: "foot", side: "left" },
        { part: "lower_back", side: "right" },
      ],
    });

    expect(result).toEqual([
      { part: "neck", markers: [{ xPct: 44, yPct: 26 }], side: undefined },
      { part: "foot", side: "left", markers: [{ xPct: 52, yPct: 71 }] },
      { part: "lower_back", side: "right", markers: [] },
    ]);
  });

  it("renders selected parts when no marker coordinates were captured", () => {
    const result = mergeDiagramSelectionsForDisplay({
      markerSelections: [],
      selectedParts: [{ part: "foot" }, { part: "neck" }],
    });

    expect(result).toEqual([
      { part: "foot", side: undefined, markers: [] },
      { part: "neck", side: undefined, markers: [] },
    ]);
  });
});
