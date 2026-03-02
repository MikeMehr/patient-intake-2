import { describe, expect, it } from "vitest";
import { parseJsonObject } from "@/lib/safe-json";

describe("safe-json", () => {
  it("parses valid JSON objects", () => {
    const parsed = parseJsonObject('{"a":1}', "test payload");
    expect(parsed.a).toBe(1);
  });

  it("rejects invalid or non-object JSON", () => {
    expect(() => parseJsonObject("nope", "test payload")).toThrow(/not valid json/i);
    expect(() => parseJsonObject('["a"]', "test payload")).toThrow(/must be a json object/i);
  });
});
