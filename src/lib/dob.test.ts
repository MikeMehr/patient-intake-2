import { describe, expect, it } from "vitest";
import { composeDob, daysInMonth, dobProblem, parseDob } from "./dob";

describe("composeDob", () => {
  it("composes a valid date", () => {
    expect(composeDob("06", "02", "1948")).toBe("1948-06-02");
  });

  it("pads single-digit month and day input", () => {
    expect(composeDob("3", "7", "1950")).toBe("1950-03-07");
  });

  it("accepts Feb 29 on a leap year only", () => {
    expect(composeDob("02", "29", "2024")).toBe("2024-02-29");
    expect(composeDob("02", "29", "2023")).toBe("");
  });

  it("rejects days beyond the month's length", () => {
    expect(composeDob("04", "31", "1990")).toBe("");
    expect(composeDob("06", "31", "1990")).toBe("");
  });

  it("enforces year bounds", () => {
    expect(composeDob("01", "01", "1899")).toBe("");
    expect(composeDob("01", "01", "1900")).toBe("1900-01-01");
    expect(composeDob("01", "01", String(new Date().getFullYear() + 1))).toBe("");
  });

  it("rejects future dates in the current year", () => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (tomorrow.getFullYear() === now.getFullYear()) {
      expect(
        composeDob(
          String(tomorrow.getMonth() + 1),
          String(tomorrow.getDate()),
          String(tomorrow.getFullYear()),
        ),
      ).toBe("");
    }
    expect(composeDob("01", "01", String(now.getFullYear()))).toBe(
      `${now.getFullYear()}-01-01`,
    );
  });

  it("never emits partials", () => {
    expect(composeDob("", "15", "1980")).toBe("");
    expect(composeDob("05", "", "1980")).toBe("");
    expect(composeDob("05", "15", "")).toBe("");
    expect(composeDob("05", "15", "19")).toBe(""); // 2-digit year is still mid-entry
    expect(composeDob("05", "15", "198")).toBe("");
  });

  it("rejects non-numeric garbage", () => {
    expect(composeDob("ab", "15", "1980")).toBe("");
    expect(composeDob("05", "1x", "1980")).toBe("");
    expect(composeDob("05", "15", "19x0")).toBe("");
  });
});

describe("parseDob", () => {
  it("round-trips a valid value", () => {
    const p = parseDob("1948-06-02");
    expect(p).toEqual({ year: "1948", month: "06", day: "02" });
    expect(composeDob(p.month, p.day, p.year)).toBe("1948-06-02");
  });

  it("returns empty parts for empty or malformed input", () => {
    expect(parseDob("")).toEqual({ month: "", day: "", year: "" });
    expect(parseDob("junk")).toEqual({ month: "", day: "", year: "" });
    expect(parseDob("1948-6-2")).toEqual({ month: "", day: "", year: "" });
  });
});

describe("daysInMonth", () => {
  it("allows 29 for February while the year is unknown", () => {
    expect(daysInMonth(2)).toBe(29);
    expect(daysInMonth(2, 2023)).toBe(28);
    expect(daysInMonth(2, 2024)).toBe(29);
    expect(daysInMonth(4, 1990)).toBe(30);
    expect(daysInMonth(12, 1990)).toBe(31);
  });
});

describe("dobProblem", () => {
  it("stays quiet while any part is incomplete", () => {
    expect(dobProblem("", "31", "1990")).toBeNull();
    expect(dobProblem("04", "", "1990")).toBeNull();
    expect(dobProblem("04", "31", "199")).toBeNull();
  });

  it("is null for a valid date", () => {
    expect(dobProblem("06", "02", "1948")).toBeNull();
  });

  it("explains an impossible day", () => {
    expect(dobProblem("04", "31", "1990")).toMatch(/April 1990 has only 30 days/);
    expect(dobProblem("02", "29", "2023")).toMatch(/February 2023 has only 28 days/);
  });

  it("explains an out-of-range year", () => {
    expect(dobProblem("01", "01", "1899")).toMatch(/between 1900 and/);
    expect(dobProblem("01", "01", "3000")).toMatch(/between 1900 and/);
  });
});
