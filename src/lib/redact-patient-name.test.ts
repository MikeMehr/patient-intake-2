import { describe, it, expect } from "vitest";
import { redactPatientName } from "@/lib/redact-patient-name";

/**
 * These tests are the spec for the Java port in mymd.billing.DayBilling.
 *
 * Day billing redacts on the OSCAR box rather than here, because the patient's name must never
 * leave the clinic — sending the name along so this function could strip it would defeat the
 * purpose. The port has to match the behaviour pinned below; if you change one, change both.
 * See docs/oscar/day-billing-install.md.
 */
describe("redactPatientName", () => {
  it('redacts "First Last"', () => {
    expect(redactPatientName("Seen Jane Doe today.", "Jane Doe")).toBe("Seen [REDACTED] today.");
  });

  it('redacts "Last, First"', () => {
    expect(redactPatientName("Chart: Doe, Jane", "Jane Doe")).toBe("Chart: [REDACTED]");
  });

  it('redacts "Last,First" with no space', () => {
    expect(redactPatientName("Chart: Doe,Jane", "Jane Doe")).toBe("Chart: [REDACTED]");
  });

  it("is case-insensitive", () => {
    expect(redactPatientName("seen JANE DOE today", "Jane Doe")).toBe("seen [REDACTED] today");
  });

  it("replaces every occurrence", () => {
    expect(redactPatientName("Jane Doe. Later, Jane Doe again.", "Jane Doe")).toBe(
      "[REDACTED]. Later, [REDACTED] again.",
    );
  });

  // Deliberate: a bare surname is far too likely to be the physician's own name, or a common word.
  it("leaves a first or last name alone on its own", () => {
    expect(redactPatientName("Jane reports improvement.", "Jane Doe")).toBe("Jane reports improvement.");
    expect(redactPatientName("Discussed with Doe.", "Jane Doe")).toBe("Discussed with Doe.");
  });

  it("uses first and last when the name has a middle part", () => {
    expect(redactPatientName("Doe, Jane seen.", "Jane Marie Doe")).toBe("[REDACTED] seen.");
    expect(redactPatientName("Jane Marie Doe seen.", "Jane Marie Doe")).toBe("[REDACTED] seen.");
  });

  it("returns the text untouched for a blank name", () => {
    expect(redactPatientName("Some note.", "   ")).toBe("Some note.");
  });

  it("treats regex characters in a name literally", () => {
    expect(redactPatientName("Seen A. (Bob) today", "A. (Bob)")).toBe("Seen [REDACTED] today");
  });

  it("handles a single-word name without throwing", () => {
    expect(redactPatientName("Cher attended.", "Cher")).toBe("[REDACTED] attended.");
  });
});
