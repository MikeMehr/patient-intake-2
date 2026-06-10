import { describe, it, expect } from "vitest";
import { normalizeOscarDob, extractOscarDob } from "./dob";

describe("normalizeOscarDob", () => {
  it("accepts plain ISO dates", () => {
    expect(normalizeOscarDob("1981-09-16")).toBe("1981-09-16");
  });

  it("accepts datetime strings (space- and T-separated)", () => {
    expect(normalizeOscarDob("1981-09-16 00:00:00")).toBe("1981-09-16");
    expect(normalizeOscarDob("1981-09-16T00:00:00.000-07:00")).toBe("1981-09-16");
  });

  it("accepts slash-separated and unpadded month/day", () => {
    expect(normalizeOscarDob("1981/09/16")).toBe("1981-09-16");
    expect(normalizeOscarDob("1981-9-6")).toBe("1981-09-06");
  });

  it("accepts epoch milliseconds (number and string)", () => {
    const ms = Date.UTC(1981, 8, 16); // month is 0-based → Sept
    expect(normalizeOscarDob(ms)).toBe("1981-09-16");
    expect(normalizeOscarDob(String(ms))).toBe("1981-09-16");
  });

  it("does NOT misread a bare day-of-month as a date", () => {
    expect(normalizeOscarDob("16")).toBeNull();
    expect(normalizeOscarDob(16)).toBeNull();
  });

  it("rejects empty / nonsense / out-of-range", () => {
    expect(normalizeOscarDob("")).toBeNull();
    expect(normalizeOscarDob(null)).toBeNull();
    expect(normalizeOscarDob(undefined)).toBeNull();
    expect(normalizeOscarDob("not-a-date")).toBeNull();
    expect(normalizeOscarDob("1981-13-40")).toBeNull();
  });
});

describe("extractOscarDob", () => {
  it("reads a combined dob field", () => {
    expect(extractOscarDob({ dob: "1981-09-16" })).toBe("1981-09-16");
    expect(extractOscarDob({ dateOfBirth: "1981-09-16 00:00:00" })).toBe("1981-09-16");
  });

  it("reconstructs from split year/month/day where day lives in dateOfBirth", () => {
    // OSCAR DemographicTo1 shape: dateOfBirth holds the day-of-month.
    expect(
      extractOscarDob({ yearOfBirth: "1981", monthOfBirth: "09", dateOfBirth: "16" }),
    ).toBe("1981-09-16");
    expect(
      extractOscarDob({ yearOfBirth: 1981, monthOfBirth: 9, dateOfBirth: 16 }),
    ).toBe("1981-09-16");
  });

  it("prefers a full combined date over component reconstruction", () => {
    expect(
      extractOscarDob({
        dateOfBirth: "1981-09-16T00:00:00",
        yearOfBirth: "1999",
        monthOfBirth: "01",
      }),
    ).toBe("1981-09-16");
  });

  it("returns null when nothing usable is present", () => {
    expect(extractOscarDob({})).toBeNull();
    expect(extractOscarDob(null)).toBeNull();
    expect(extractOscarDob({ yearOfBirth: "1981" })).toBeNull(); // missing month/day
  });
});
