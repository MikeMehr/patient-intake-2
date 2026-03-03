import { describe, expect, it } from "vitest";

import { patientUploadsSchema } from "./history-schema";

describe("patientUploadsSchema bodyDiagram markers", () => {
  it("accepts structured markers for multiple body diagrams", () => {
    const parsed = patientUploadsSchema.safeParse({
      bodyDiagram: {
        selectedParts: [
          { part: "ankle", side: "left" },
          { part: "knee", side: "right" },
        ],
        markersByPart: [
          {
            part: "ankle",
            side: "left",
            markers: [
              { xPct: 25.1, yPct: 64.2 },
              { xPct: 42.0, yPct: 72.6 },
            ],
          },
          {
            part: "knee",
            side: "right",
            markers: [{ xPct: 51.3, yPct: 30.8 }],
          },
        ],
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects invalid side values for markersByPart entries", () => {
    const parsed = patientUploadsSchema.safeParse({
      bodyDiagram: {
        markersByPart: [
          {
            part: "foot",
            side: "both",
            markers: [{ xPct: 10, yPct: 20 }],
          },
        ],
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("keeps legacy selectedArea and leftSoleMarkers compatible", () => {
    const parsed = patientUploadsSchema.safeParse({
      bodyDiagram: {
        selectedArea: 3,
        leftSoleMarkers: [{ xPct: 44, yPct: 81 }],
      },
    });

    expect(parsed.success).toBe(true);
  });
});
