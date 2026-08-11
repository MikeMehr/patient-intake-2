/**
 * Normalizes PathwaysBC's global data export into rows bc-specialist-directory.ts can upsert.
 *
 * PathwaysBC serves its entire province-wide dataset as one JSON blob on every logged-in page
 * load (a presigned S3 URL — see src/lib/pathways/client.ts for how it's fetched). This module
 * only knows how to read that shape; it does no I/O, so it can be unit-tested against a fixture
 * without a browser or a database.
 *
 * Field names below (waittime, cityIds, specializationIds, billingNumber, referralIconKey,
 * acceptsReferralsVia*) are PathwaysBC's own, confirmed against a live export on 2026-08-11.
 */

export type PathwaysRawSpecialist = {
  id: number;
  name: string;
  lastName: string;
  honorific?: string | null;
  cityIds?: number[];
  specializationIds?: number[];
  billingNumber?: string | null;
  waittime?: string | null;
  acceptsReferralsViaFax?: boolean;
  acceptsReferralsViaPhone?: boolean;
  acceptsReferralsViaProvincialPlatform?: boolean;
  isPracticing?: boolean;
  referralIconKey?: string | null;
  hidden?: boolean;
};

export type PathwaysGlobalData = {
  specialists: Record<string, PathwaysRawSpecialist>;
  cities?: Record<string, unknown>;
  specializations?: Record<string, unknown>;
};

export type NormalizedSpecialist = {
  pathwaysId: number;
  name: string;
  lastName: string;
  honorific: string | null;
  specialization: string;
  city: string | null;
  billingNumber: string | null;
  waitTime: string | null;
  waitTimeRank: number | null;
  acceptsReferralsViaFax: boolean;
  acceptsReferralsViaPhone: boolean;
  acceptsReferralsViaProvincialPlatform: boolean;
  isPracticing: boolean;
  referralIconKey: string | null;
};

// Bucket text -> an approximate day count, used only to sort. PathwaysBC's exact bucket
// vocabulary isn't documented anywhere we control, so this parses the shape of the text
// ("within N units", "N-M units", "N+ units") rather than matching a fixed enum — any new
// bucket wording PathwaysBC introduces still sorts sensibly as long as it fits that shape.
const UNIT_TO_DAYS: Record<string, number> = {
  day: 1,
  days: 1,
  week: 7,
  weeks: 7,
  month: 30,
  months: 30,
  year: 365,
  years: 365,
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

function toNumber(token: string): number | null {
  if (WORD_NUMBERS[token] !== undefined) return WORD_NUMBERS[token];
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

/** Lower = faster. Returns null when the text doesn't parse (sorts last, not first). */
export function parseWaitTimeRank(waitTime: string | null | undefined): number | null {
  if (!waitTime) return null;
  const text = waitTime.toLowerCase().trim();

  const within = text.match(/^within\s+([a-z0-9]+)\s+(day|days|week|weeks|month|months|year|years)$/);
  if (within) {
    const n = toNumber(within[1]);
    const unit = UNIT_TO_DAYS[within[2]];
    if (n !== null) return Math.round((n * unit) / 2);
  }

  const range = text.match(/([a-z0-9]+)\s*-\s*([a-z0-9]+)\s*(day|days|week|weeks|month|months|year|years)/);
  if (range) {
    const lo = toNumber(range[1]);
    const hi = toNumber(range[2]);
    const unit = UNIT_TO_DAYS[range[3]];
    if (lo !== null && hi !== null) return Math.round(((lo + hi) / 2) * unit);
  }

  const single = text.match(/([a-z0-9]+)\+?\s*(day|days|week|weeks|month|months|year|years)/);
  if (single) {
    const n = toNumber(single[1]);
    const unit = UNIT_TO_DAYS[single[2]];
    if (n !== null) return n * unit;
  }

  return null;
}

/**
 * PathwaysBC's lookup collections (cities, specializations) are dicts keyed by id. Read
 * defensively — `{ name }` is what we've observed, but fall back to a bare string in case a
 * collection is ever shaped that way, and to null rather than throwing for anything else, since
 * one malformed lookup entry shouldn't fail the whole sync.
 */
function lookupName(collection: Record<string, unknown> | undefined, id: number | undefined): string | null {
  if (!collection || id === undefined || id === null) return null;
  const entry = collection[String(id)];
  if (entry == null) return null;
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && "name" in (entry as Record<string, unknown>)) {
    const name = (entry as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

/**
 * Normalize the raw export into upsert-ready rows.
 *
 * A specialist missing id/name/lastName, or one PathwaysBC itself has marked `hidden`, is
 * skipped rather than aborting the whole sync — a handful of malformed or suppressed entries in
 * an ~8,300-row export is expected, not a reason to leave the directory stale.
 */
export function parsePathwaysGlobalData(raw: unknown): NormalizedSpecialist[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("parsePathwaysGlobalData: expected an object");
  }
  const data = raw as Partial<PathwaysGlobalData>;
  if (!data.specialists || typeof data.specialists !== "object") {
    throw new Error("parsePathwaysGlobalData: missing 'specialists' collection");
  }
  const cities = (data.cities ?? {}) as Record<string, unknown>;
  const specializations = (data.specializations ?? {}) as Record<string, unknown>;

  const out: NormalizedSpecialist[] = [];
  for (const entry of Object.values(data.specialists)) {
    if (!entry || typeof entry !== "object") continue;
    if (!entry.id || !entry.name || !entry.lastName) continue;
    if (entry.hidden) continue;

    const specialization = lookupName(specializations, entry.specializationIds?.[0]) ?? "Unspecified";
    const city = lookupName(cities, entry.cityIds?.[0]);
    const waitTime = entry.waittime ?? null;

    out.push({
      pathwaysId: entry.id,
      name: entry.name,
      lastName: entry.lastName,
      honorific: entry.honorific ?? null,
      specialization,
      city,
      billingNumber: entry.billingNumber ?? null,
      waitTime,
      waitTimeRank: parseWaitTimeRank(waitTime),
      acceptsReferralsViaFax: Boolean(entry.acceptsReferralsViaFax),
      acceptsReferralsViaPhone: Boolean(entry.acceptsReferralsViaPhone),
      acceptsReferralsViaProvincialPlatform: Boolean(entry.acceptsReferralsViaProvincialPlatform),
      isPracticing: entry.isPracticing !== false,
      referralIconKey: entry.referralIconKey ?? null,
    });
  }
  return out;
}
