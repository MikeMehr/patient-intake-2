import { describe, expect, it } from "vitest";
import { isPasswordContextWordSafe } from "./password-context";

describe("password-context", () => {
  it("rejects passwords containing configured context words", () => {
    expect(isPasswordContextWordSafe("HealthAssist123!")).toBe(false);
    expect(isPasswordContextWordSafe("DocProvider987!")).toBe(false);
  });

  it("rejects common substitution variants", () => {
    expect(isPasswordContextWordSafe("h3alth-assist!55")).toBe(false);
  });

  it("accepts passwords without context words", () => {
    expect(isPasswordContextWordSafe("T!gerMoon928")).toBe(true);
  });
});

