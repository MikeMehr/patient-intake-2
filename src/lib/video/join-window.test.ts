import { describe, expect, it } from "vitest";
import {
  JOIN_CLOSES_AFTER_END_MS,
  JOIN_OPENS_BEFORE_START_MS,
  joinOpensAt,
  resolveJoinState,
  roomExpiryFor,
} from "./join-window";

const START = new Date("2026-08-05T17:00:00.000Z");
const END = new Date("2026-08-05T17:20:00.000Z");
const FAR_FUTURE = new Date("2026-08-30T00:00:00.000Z");

function state(overrides: Partial<Parameters<typeof resolveJoinState>[0]> = {}) {
  return resolveJoinState({
    now: START,
    scheduledStartAt: START,
    scheduledEndAt: END,
    cancelledAt: null,
    tokenExpiresAt: FAR_FUTURE,
    status: "ACTIVE",
    ...overrides,
  });
}

describe("resolveJoinState", () => {
  it("is open at the scheduled start", () => {
    expect(state()).toBe("open");
  });

  it("opens exactly 15 minutes before the start, not a moment sooner", () => {
    const opensAt = new Date(START.getTime() - JOIN_OPENS_BEFORE_START_MS);
    expect(state({ now: new Date(opensAt.getTime() - 1) })).toBe("too_early");
    expect(state({ now: opensAt })).toBe("open");
  });

  it("stays open through the appointment and the grace period after it", () => {
    expect(state({ now: END })).toBe("open");
    expect(state({ now: new Date(END.getTime() + JOIN_CLOSES_AFTER_END_MS - 1) })).toBe("open");
  });

  it("closes exactly one hour after the scheduled end", () => {
    expect(state({ now: new Date(END.getTime() + JOIN_CLOSES_AFTER_END_MS) })).toBe("ended");
  });

  it("assumes a 30-minute visit when no end time is recorded", () => {
    const assumedEnd = START.getTime() + 30 * 60 * 1000;
    expect(
      state({ scheduledEndAt: null, now: new Date(assumedEnd + JOIN_CLOSES_AFTER_END_MS - 1) }),
    ).toBe("open");
    expect(
      state({ scheduledEndAt: null, now: new Date(assumedEnd + JOIN_CLOSES_AFTER_END_MS) }),
    ).toBe("ended");
  });

  it("treats an unscheduled visit as open — an OSCAR-only room has no time to be early for", () => {
    expect(state({ scheduledStartAt: null, scheduledEndAt: null })).toBe("open");
    // Even long after what would have been the window, until the token dies.
    expect(
      state({ scheduledStartAt: null, scheduledEndAt: null, now: new Date("2026-08-20T00:00:00Z") }),
    ).toBe("open");
  });

  // Precedence — each of these must beat "open", or a closed visit hands out a room credential.

  it("reports cancelled even during what would be the open window", () => {
    expect(state({ cancelledAt: new Date("2026-08-01T00:00:00Z") })).toBe("cancelled");
    expect(state({ status: "CANCELLED" })).toBe("cancelled");
  });

  it("reports expired once the token dies, even mid-appointment", () => {
    expect(state({ tokenExpiresAt: new Date(START.getTime() - 1) })).toBe("expired");
  });

  it("puts cancelled ahead of expired", () => {
    expect(
      state({ cancelledAt: new Date("2026-08-01T00:00:00Z"), tokenExpiresAt: new Date(0) }),
    ).toBe("cancelled");
  });

  it("reports an explicitly ended visit as ended", () => {
    expect(state({ status: "ENDED" })).toBe("ended");
  });
});

describe("joinOpensAt", () => {
  it("is 15 minutes before the start", () => {
    expect(joinOpensAt(START)?.toISOString()).toBe("2026-08-05T16:45:00.000Z");
  });

  it("is null when there is no schedule", () => {
    expect(joinOpensAt(null)).toBeNull();
  });
});

describe("roomExpiryFor", () => {
  it("outlives the join window so the room never ends the consultation", () => {
    const expiry = roomExpiryFor(END, START);
    expect(expiry.getTime()).toBeGreaterThan(END.getTime() + JOIN_CLOSES_AFTER_END_MS);
  });

  it("gives an ad-hoc room a sensible life when there is no schedule", () => {
    const now = new Date("2026-08-05T17:00:00.000Z");
    expect(roomExpiryFor(null, now).getTime()).toBeGreaterThan(now.getTime());
  });

  it("does not hand back an already-expired room for a past appointment", () => {
    const now = new Date("2026-08-06T00:00:00.000Z");
    expect(roomExpiryFor(END, now).getTime()).toBeGreaterThan(now.getTime());
  });
});
