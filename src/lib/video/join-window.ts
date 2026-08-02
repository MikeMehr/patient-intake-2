/**
 * When a patient may enter their video visit.
 *
 * Kept pure and dependency-free so the boundaries can be unit-tested directly instead of
 * against the wall clock, and so the same rule runs in the validation endpoint, the join
 * endpoint and the status poll without drifting between them.
 *
 * Everything here is instant arithmetic on TIMESTAMPTZ values. There is deliberately no clinic
 * timezone and no call to toClinicLocalParts(): "15 minutes before the appointment" is a
 * duration, and computing it through a wall-clock conversion is how a visit ends up unjoinable
 * for an hour on the two DST changeover days each year.
 */

/** How early the patient can get into the waiting room. */
export const JOIN_OPENS_BEFORE_START_MS = 15 * 60 * 1000;

/** How long after the scheduled end the room stays enterable, for visits that run over. */
export const JOIN_CLOSES_AFTER_END_MS = 60 * 60 * 1000;

/** Assumed length when a visit has a start but no end recorded. */
const ASSUMED_DURATION_MS = 30 * 60 * 1000;

export type JoinState = "too_early" | "open" | "ended" | "cancelled" | "expired";

export type JoinWindowInput = {
  now: Date;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  cancelledAt: Date | null;
  tokenExpiresAt: Date;
  status: string;
};

/**
 * Precedence is intentional: a cancelled visit reads as cancelled even during what would have
 * been its window, and an expired token reads as expired even for a visit that is notionally
 * still open. The patient should be told the true reason, and neither state should fall through
 * to a code path that hands out a room credential.
 */
export function resolveJoinState(input: JoinWindowInput): JoinState {
  const { now, scheduledStartAt, scheduledEndAt, cancelledAt, tokenExpiresAt, status } = input;

  if (cancelledAt !== null || status === "CANCELLED") return "cancelled";
  if (now.getTime() >= tokenExpiresAt.getTime()) return "expired";
  if (status === "ENDED") return "ended";

  // OSCAR-only visits carry no schedule — the day-sheet button gives us an appointment number,
  // not a time. There is nothing to be early or late for, so the token's own lifetime is the
  // only bound, and it was already checked above.
  if (!scheduledStartAt) return "open";

  const opensAt = scheduledStartAt.getTime() - JOIN_OPENS_BEFORE_START_MS;
  if (now.getTime() < opensAt) return "too_early";

  const endsAt = scheduledEndAt
    ? scheduledEndAt.getTime()
    : scheduledStartAt.getTime() + ASSUMED_DURATION_MS;
  if (now.getTime() >= endsAt + JOIN_CLOSES_AFTER_END_MS) return "ended";

  return "open";
}

/** The instant the waiting room unlocks, for the patient-facing countdown. */
export function joinOpensAt(scheduledStartAt: Date | null): Date | null {
  return scheduledStartAt
    ? new Date(scheduledStartAt.getTime() - JOIN_OPENS_BEFORE_START_MS)
    : null;
}

/**
 * How long a Daily room should live. Past the join window on both ends so a room is never the
 * thing that ends a consultation — the meeting token's own expiry does that.
 */
export function roomExpiryFor(scheduledEndAt: Date | null, now: Date): Date {
  const base = scheduledEndAt && scheduledEndAt.getTime() > now.getTime()
    ? scheduledEndAt.getTime()
    : now.getTime() + ASSUMED_DURATION_MS;
  return new Date(base + JOIN_CLOSES_AFTER_END_MS + 30 * 60 * 1000);
}
