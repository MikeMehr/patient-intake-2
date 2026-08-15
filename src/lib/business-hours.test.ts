import { describe, it, expect } from "vitest";
import {
  checkBusinessHours,
  formatMinutes,
  partsFromLocalString,
  partsInZone,
} from "./business-hours";

function local(s: string) {
  const p = partsFromLocalString(s);
  if (!p) throw new Error(`unparseable: ${s}`);
  return p;
}

describe("formatMinutes", () => {
  it("renders 12-hour clock times", () => {
    expect(formatMinutes(8 * 60)).toBe("8:00 AM");
    expect(formatMinutes(18 * 60 + 45)).toBe("6:45 PM");
    expect(formatMinutes(19 * 60)).toBe("7:00 PM");
    expect(formatMinutes(12 * 60)).toBe("12:00 PM");
    expect(formatMinutes(0)).toBe("12:00 AM");
  });
});

describe("checkBusinessHours", () => {
  it("accepts a slot inside 8:00 AM – 7:00 PM", () => {
    expect(
      checkBusinessHours(local("2026-08-14T09:00"), local("2026-08-14T09:15")),
    ).toBeNull();
  });

  it("accepts the boundaries: 8:00 AM start and 7:00 PM end", () => {
    expect(
      checkBusinessHours(local("2026-08-14T08:00"), local("2026-08-14T08:15")),
    ).toBeNull();
    expect(
      checkBusinessHours(local("2026-08-14T18:45"), local("2026-08-14T19:00")),
    ).toBeNull();
  });

  it("rejects the 8 PM-for-8 AM slip", () => {
    const err = checkBusinessHours(
      local("2026-08-14T20:00"),
      local("2026-08-14T20:30"),
    );
    expect(err).toMatch(/latest an appointment can start is 6:45 PM/);
    expect(err).toMatch(/8:00 PM/);
  });

  it("rejects a start before 8:00 AM", () => {
    expect(
      checkBusinessHours(local("2026-08-14T07:45"), local("2026-08-14T08:15")),
    ).toMatch(/can't start before 8:00 AM/);
  });

  it("rejects an end past 7:00 PM", () => {
    expect(
      checkBusinessHours(local("2026-08-14T18:45"), local("2026-08-14T19:15")),
    ).toMatch(/must end by 7:00 PM/);
  });

  it("rejects a range that spans two days", () => {
    expect(
      checkBusinessHours(local("2026-08-14T18:00"), local("2026-08-15T09:00")),
    ).toMatch(/same day/);
  });
});

describe("partsInZone", () => {
  it("reads the clinic-local wall clock from a UTC instant", () => {
    // 2026-08-14T15:00Z is 8:00 AM in Vancouver (PDT, UTC-7).
    expect(partsInZone(new Date("2026-08-14T15:00:00Z"), "America/Vancouver")).toEqual({
      date: "2026-08-14",
      minutes: 8 * 60,
    });
  });

  it("uses h23 so local midnight is 0, not 24", () => {
    // 2026-08-14T07:00Z is midnight in Vancouver.
    expect(partsInZone(new Date("2026-08-14T07:00:00Z"), "America/Vancouver")).toEqual({
      date: "2026-08-14",
      minutes: 0,
    });
  });

  it("rejects a UTC-8 PM instant that is 8 PM locally", () => {
    // 2026-08-15T03:00Z is 8:00 PM Aug 14 in Vancouver.
    const start = partsInZone(new Date("2026-08-15T03:00:00Z"), "America/Vancouver");
    const end = partsInZone(new Date("2026-08-15T03:30:00Z"), "America/Vancouver");
    expect(checkBusinessHours(start, end)).toMatch(/6:45 PM/);
  });
});
