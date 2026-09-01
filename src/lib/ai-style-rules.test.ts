import { describe, expect, it } from "vitest";
import {
  MAX_RULES_PER_TYPE,
  MAX_RULE_LENGTH,
  buildDistillationMessages,
  formatStyleRulesAppendix,
  sanitizeRules,
} from "./ai-style-rules";

describe("sanitizeRules", () => {
  it("returns empty for non-array input", () => {
    expect(sanitizeRules(null)).toEqual([]);
    expect(sanitizeRules("Use metric units")).toEqual([]);
    expect(sanitizeRules({ rules: [] })).toEqual([]);
  });

  it("drops non-strings and empty strings, trims and collapses whitespace", () => {
    expect(sanitizeRules([42, "", "   ", "Use  metric\n units only  "])).toEqual([
      "Use metric units only",
    ]);
  });

  it("drops rules over the max length", () => {
    const long = "a".repeat(MAX_RULE_LENGTH + 1);
    expect(sanitizeRules([long, "Short rule"])).toEqual(["Short rule"]);
  });

  it("caps at the max rule count", () => {
    const rules = Array.from({ length: MAX_RULES_PER_TYPE + 5 }, (_, i) => `Rule number ${i}`);
    expect(sanitizeRules(rules)).toHaveLength(MAX_RULES_PER_TYPE);
  });

  it("dedupes case-insensitively", () => {
    expect(sanitizeRules(["Use SI units", "use si units", "Use SI Units"])).toEqual(["Use SI units"]);
  });

  it("drops rules with date-like content", () => {
    expect(sanitizeRules(["Seen on 2026-08-01 for follow-up"])).toEqual([]);
    expect(sanitizeRules(["Follow up 12/31/2026"])).toEqual([]);
  });

  it("drops rules with long digit runs or phone numbers", () => {
    expect(sanitizeRules(["PHN 9876543210 goes first"])).toEqual([]);
    expect(sanitizeRules(["Call 604-880-7919 to confirm"])).toEqual([]);
  });

  it("drops rules referencing a specific patient", () => {
    expect(sanitizeRules(["Mention this patient prefers morning visits"])).toEqual([]);
    expect(sanitizeRules(["Include Mrs. Smith in the header"])).toEqual([]);
    expect(sanitizeRules(["Always include DOB in the header"])).toEqual([]);
  });

  it("keeps clean style rules", () => {
    const clean = ["Write the plan as numbered steps", "Use standard abbreviations for labs"];
    expect(sanitizeRules(clean)).toEqual(clean);
  });
});

describe("formatStyleRulesAppendix", () => {
  it("returns empty string for no rules", () => {
    expect(formatStyleRulesAppendix([], "SOAP notes")).toBe("");
  });

  it("includes the scope label, guard lines, and every rule as a bullet", () => {
    const out = formatStyleRulesAppendix(["Use metric units", "Keep plans numbered"], "SOAP notes");
    expect(out).toContain("PHYSICIAN STYLE PREFERENCES");
    expect(out).toContain("SOAP notes");
    expect(out).toContain("NEVER add, remove, or alter clinical facts");
    expect(out).toContain("- Use metric units");
    expect(out).toContain("- Keep plans numbered");
  });
});

describe("buildDistillationMessages", () => {
  it("renders existing rules numbered", () => {
    const [system, user] = buildDistillationMessages({
      noteType: "soap",
      originalText: "orig",
      editedText: "edit",
      existingRules: ["Rule A", "Rule B"],
    });
    expect(system.role).toBe("system");
    expect(system.content).toContain('{"rules": string[]}');
    expect(user.content).toContain("1. Rule A");
    expect(user.content).toContain("2. Rule B");
  });

  it("renders (none) when no existing rules and includes both texts", () => {
    const [, user] = buildDistillationMessages({
      noteType: "recommendations_imaging",
      originalText: "the original text",
      editedText: "the edited text",
      existingRules: [],
    });
    expect(user.content).toContain("(none)");
    expect(user.content).toContain("ORIGINAL (AI):\nthe original text");
    expect(user.content).toContain("EDITED (physician):\nthe edited text");
    expect(user.content).toContain("imaging requisition");
  });
});
