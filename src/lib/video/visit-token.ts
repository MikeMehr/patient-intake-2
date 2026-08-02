import { createHash, randomBytes } from "crypto";

/**
 * The patient's credential for a video visit, in the same shape as the appointment manage token
 * (`src/lib/booking-token.ts`) and the document tokens: 32 random bytes in the link, only the
 * SHA-256 hash in the database.
 *
 * The TTL is much shorter than the manage token's 30 days. This one is a key to a live
 * consultation, so it is scoped to the visit: from issue until a day after the appointment
 * should have ended. Long enough to survive a visit that starts late or runs over, short enough
 * that an old confirmation email in a shared inbox stops being a way in.
 */
const VISIT_TOKEN_TTL_AFTER_END_MS = 24 * 60 * 60 * 1000;

/** Fallback lifetime when the visit has no scheduled end — OSCAR-only rooms, created ad hoc. */
const VISIT_TOKEN_TTL_UNSCHEDULED_MS = 12 * 60 * 60 * 1000;

export function generateVisitToken(scheduledEndAt: Date | null): {
  raw: string;
  hash: string;
  expiresAt: Date;
} {
  const raw = randomBytes(32).toString("hex");
  const expiresAt = scheduledEndAt
    ? new Date(scheduledEndAt.getTime() + VISIT_TOKEN_TTL_AFTER_END_MS)
    : new Date(Date.now() + VISIT_TOKEN_TTL_UNSCHEDULED_MS);
  return { raw, hash: hashVisitToken(raw), expiresAt };
}

/** Hash a raw visit token for DB lookup. */
export function hashVisitToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Shape check before the token ever reaches a query. Cheap, and it keeps junk from a crawler
 * out of both the database and the rate-limit table.
 */
export function isVisitTokenShape(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
