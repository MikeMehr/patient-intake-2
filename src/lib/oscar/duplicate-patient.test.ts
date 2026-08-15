import { describe, expect, it } from "vitest";
import {
  duplicateChartMessage,
  findDuplicateChart,
  normalizeHealthCard,
  normalizeNameForMatch,
} from "./duplicate-patient";

const SUBJECT = { firstName: "Jane", lastName: "Doe", healthCardNumber: "9012345678" };

describe("normalizeHealthCard", () => {
  it("strips the separators people type", () => {
    expect(normalizeHealthCard("9012 345-678")).toBe("9012345678");
    expect(normalizeHealthCard(" 9012345678 ")).toBe("9012345678");
  });

  it("keeps letters (Ontario version codes) and uppercases them", () => {
    expect(normalizeHealthCard("1234567890ab")).toBe("1234567890AB");
  });

  it("returns empty for nullish input", () => {
    expect(normalizeHealthCard(null)).toBe("");
    expect(normalizeHealthCard(undefined)).toBe("");
  });
});

describe("normalizeNameForMatch", () => {
  it("folds accents and case", () => {
    expect(normalizeNameForMatch("Émilie")).toBe("emilie");
    expect(normalizeNameForMatch("O'BRIEN")).toBe("obrien");
  });

  it("keeps only the first token", () => {
    expect(normalizeNameForMatch("Ann Marie")).toBe("ann");
    expect(normalizeNameForMatch("Doe, Jane")).toBe("doe");
  });
});

describe("findDuplicateChart", () => {
  it("matches on name + card even though the date of birth differed", () => {
    const hit = findDuplicateChart(
      [{ demographicNo: "4321", firstName: "Jane", lastName: "Doe", healthCardNumber: "9012 345 678" }],
      SUBJECT,
    );
    expect(hit?.demographicNo).toBe("4321");
  });

  it("matches a shortened given name", () => {
    const hit = findDuplicateChart(
      [{ demographicNo: "7", firstName: "Christopher", lastName: "Doe", healthCardNumber: "9012345678" }],
      { ...SUBJECT, firstName: "Chris" },
    );
    expect(hit?.demographicNo).toBe("7");
  });

  it("ignores a chart with the same card under a different surname", () => {
    expect(
      findDuplicateChart(
        [{ demographicNo: "7", firstName: "Jane", lastName: "Smith", healthCardNumber: "9012345678" }],
        SUBJECT,
      ),
    ).toBeNull();
  });

  it("ignores a chart with the same name but a different card", () => {
    expect(
      findDuplicateChart(
        [{ demographicNo: "7", firstName: "Jane", lastName: "Doe", healthCardNumber: "9999999999" }],
        SUBJECT,
      ),
    ).toBeNull();
  });

  it("ignores a chart with no card recorded", () => {
    expect(
      findDuplicateChart(
        [{ demographicNo: "7", firstName: "Jane", lastName: "Doe", healthCardNumber: null }],
        SUBJECT,
      ),
    ).toBeNull();
  });

  it("never matches on OSCAR's 0000000000 placeholder, which sits on many charts", () => {
    expect(
      findDuplicateChart(
        [{ demographicNo: "7", firstName: "Jane", lastName: "Doe", healthCardNumber: "0000000000" }],
        { ...SUBJECT, healthCardNumber: "0000000000" },
      ),
    ).toBeNull();
  });

  it("never matches on a card too short to be real", () => {
    expect(
      findDuplicateChart(
        [{ demographicNo: "7", firstName: "Jane", lastName: "Doe", healthCardNumber: "123" }],
        { ...SUBJECT, healthCardNumber: "123" },
      ),
    ).toBeNull();
  });

  it("returns null on an empty candidate list", () => {
    expect(findDuplicateChart([], SUBJECT)).toBeNull();
  });

  it("skips candidates with no demographic number", () => {
    expect(
      findDuplicateChart(
        [{ demographicNo: "", firstName: "Jane", lastName: "Doe", healthCardNumber: "9012345678" }],
        SUBJECT,
      ),
    ).toBeNull();
  });
});

describe("duplicateChartMessage", () => {
  it("names the field to re-check and points at the clinic", () => {
    const msg = duplicateChartMessage();
    expect(msg).toContain("date of birth");
    expect(msg).toContain("contact the clinic");
  });

  it("carries no health card number or other PHI", () => {
    expect(duplicateChartMessage()).not.toMatch(/\d/);
  });
});
