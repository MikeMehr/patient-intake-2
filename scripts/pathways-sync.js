#!/usr/bin/env node
/**
 * Refreshes bc_specialist_directory (migration 074) from PathwaysBC's global data export.
 *
 * PathwaysBC serves its entire province-wide dataset as one JSON blob on every logged-in page
 * load (a presigned S3 URL fetched by the page's own JS — there is no public API). This script
 * reuses a session saved by scripts/pathways-login.js to load the page headlessly, captures that
 * response, and upserts the result.
 *
 * This is a plain CommonJS script (not importable TS) so it can run standalone with `node`,
 * matching the other scripts/*.js files in this repo — it does not go through @/lib/db or
 * @/lib/pathways-directory, and duplicates their logic directly. Keep the wait-time parsing and
 * upsert SQL here in sync with src/lib/pathways/parse.ts and src/lib/pathways-directory.ts if
 * either changes; a future cron route should call the real TS modules instead of this file.
 *
 * Usage: DATABASE_URL=... node scripts/pathways-sync.js [session-state-path]
 *   (session path defaults to PATHWAYS_SESSION_STATE_PATH, or ./pathways-session.json)
 */

const fs = require("fs");
const { chromium } = require("playwright-core");
const { Pool } = require("pg");

const MIN_PLAUSIBLE_ROWS = 1000;

function resolveLocalBrowserExecutablePath() {
  const envPath = process.env.CHROMIUM_EXECUTABLE_PATH && process.env.CHROMIUM_EXECUTABLE_PATH.trim();
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// --- wait-time bucket text -> approximate day count, for ORDER BY. Keep in sync with
// parseWaitTimeRank in src/lib/pathways/parse.ts. ---

const UNIT_TO_DAYS = {
  day: 1,
  days: 1,
  week: 7,
  weeks: 7,
  month: 30,
  months: 30,
  year: 365,
  years: 365,
};

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function toNumber(token) {
  if (WORD_NUMBERS[token] !== undefined) return WORD_NUMBERS[token];
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

function parseWaitTimeRank(waitTime) {
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

function lookupName(collection, id) {
  if (!collection || id === undefined || id === null) return null;
  const entry = collection[String(id)];
  if (entry == null) return null;
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && "name" in entry) {
    return typeof entry.name === "string" ? entry.name : null;
  }
  return null;
}

function parsePathwaysGlobalData(raw) {
  if (!raw || typeof raw !== "object" || !raw.specialists) {
    throw new Error("parsePathwaysGlobalData: missing 'specialists' collection");
  }
  const cities = raw.cities || {};
  const specializations = raw.specializations || {};

  const out = [];
  for (const entry of Object.values(raw.specialists)) {
    if (!entry || typeof entry !== "object") continue;
    if (!entry.id || !entry.name || !entry.lastName) continue;
    if (entry.hidden) continue;

    const specialization = lookupName(specializations, entry.specializationIds && entry.specializationIds[0]) || "Unspecified";
    const city = lookupName(cities, entry.cityIds && entry.cityIds[0]);
    const waitTime = entry.waittime || null;

    out.push({
      pathwaysId: entry.id,
      name: entry.name,
      lastName: entry.lastName,
      honorific: entry.honorific || null,
      specialization,
      city,
      billingNumber: entry.billingNumber || null,
      waitTime,
      waitTimeRank: parseWaitTimeRank(waitTime),
      acceptsReferralsViaFax: Boolean(entry.acceptsReferralsViaFax),
      acceptsReferralsViaPhone: Boolean(entry.acceptsReferralsViaPhone),
      acceptsReferralsViaProvincialPlatform: Boolean(entry.acceptsReferralsViaProvincialPlatform),
      isPracticing: entry.isPracticing !== false,
      referralIconKey: entry.referralIconKey || null,
    });
  }
  return out;
}

// --- transport: headless fetch of the global data export ---

async function fetchPathwaysGlobalData(sessionStatePath) {
  if (!fs.existsSync(sessionStatePath)) {
    throw new Error(
      `No PathwaysBC session found at ${sessionStatePath}. Run 'node scripts/pathways-login.js' first.`,
    );
  }

  const executablePath = resolveLocalBrowserExecutablePath();
  if (!executablePath) {
    throw new Error(
      "No local Chrome/Chromium/Edge install found. Set CHROMIUM_EXECUTABLE_PATH to a browser binary and retry.",
    );
  }

  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ storageState: sessionStatePath });
    const page = await context.newPage();

    const responsePromise = page
      .waitForResponse((res) => res.url().includes("global_data.json"), { timeout: 30_000 })
      .catch(() => null);

    await page.goto("https://pathwaysbc.ca/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    const response = await responsePromise;

    if (!response) {
      throw new Error(
        "Never saw the global-data response — PathwaysBC likely bounced to a login page because " +
          "the saved session expired. Re-run 'node scripts/pathways-login.js'.",
      );
    }

    return await response.json();
  } finally {
    await browser.close();
  }
}

// --- DB upsert (mirrors src/lib/pathways-directory.ts — see file header) ---

async function syncBcSpecialistDirectory(pool, rows) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO bc_specialist_directory_sync_state (id, last_attempt_at)
       VALUES (TRUE, NOW())
       ON CONFLICT (id) DO UPDATE SET last_attempt_at = NOW()`,
    );

    if (rows.length < MIN_PLAUSIBLE_ROWS) {
      const message = `Parsed only ${rows.length} specialists (expected several thousand) — refusing to sync`;
      await recordSyncResult(client, "FAILED", 0, message);
      throw new Error(message);
    }

    await client.query("BEGIN");
    const syncedAt = new Date();

    await client.query(
      `INSERT INTO bc_specialist_directory
         (pathways_id, name, last_name, honorific, specialization, city, billing_number,
          wait_time, wait_time_rank, accepts_referrals_via_fax, accepts_referrals_via_phone,
          accepts_referrals_via_provincial_platform, is_practicing, referral_icon_key,
          active, synced_at)
       SELECT t.pathways_id, t.name, t.last_name, t.honorific, t.specialization, t.city,
              t.billing_number, t.wait_time, t.wait_time_rank, t.accepts_fax, t.accepts_phone,
              t.accepts_platform, t.is_practicing, t.referral_icon_key, TRUE, $15
       FROM unnest(
         $1::integer[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
         $8::text[], $9::smallint[], $10::boolean[], $11::boolean[], $12::boolean[],
         $13::boolean[], $14::text[]
       ) AS t(pathways_id, name, last_name, honorific, specialization, city, billing_number,
              wait_time, wait_time_rank, accepts_fax, accepts_phone, accepts_platform,
              is_practicing, referral_icon_key)
       ON CONFLICT (pathways_id) DO UPDATE SET
         name                                       = EXCLUDED.name,
         last_name                                  = EXCLUDED.last_name,
         honorific                                  = EXCLUDED.honorific,
         specialization                             = EXCLUDED.specialization,
         city                                       = EXCLUDED.city,
         billing_number                             = EXCLUDED.billing_number,
         wait_time                                  = EXCLUDED.wait_time,
         wait_time_rank                             = EXCLUDED.wait_time_rank,
         accepts_referrals_via_fax                  = EXCLUDED.accepts_referrals_via_fax,
         accepts_referrals_via_phone                = EXCLUDED.accepts_referrals_via_phone,
         accepts_referrals_via_provincial_platform  = EXCLUDED.accepts_referrals_via_provincial_platform,
         is_practicing                              = EXCLUDED.is_practicing,
         referral_icon_key                          = EXCLUDED.referral_icon_key,
         active                                      = TRUE,
         synced_at                                   = EXCLUDED.synced_at`,
      [
        rows.map((r) => r.pathwaysId),
        rows.map((r) => r.name),
        rows.map((r) => r.lastName),
        rows.map((r) => r.honorific),
        rows.map((r) => r.specialization),
        rows.map((r) => r.city),
        rows.map((r) => r.billingNumber),
        rows.map((r) => r.waitTime),
        rows.map((r) => r.waitTimeRank),
        rows.map((r) => r.acceptsReferralsViaFax),
        rows.map((r) => r.acceptsReferralsViaPhone),
        rows.map((r) => r.acceptsReferralsViaProvincialPlatform),
        rows.map((r) => r.isPracticing),
        rows.map((r) => r.referralIconKey),
        syncedAt,
      ],
    );

    const deactivated = await client.query(
      `UPDATE bc_specialist_directory SET active = FALSE
       WHERE active = TRUE AND synced_at < $1`,
      [syncedAt],
    );

    await client.query("COMMIT");
    await recordSyncResult(client, "OK", rows.length, null);
    return { synced: rows.length, deactivated: deactivated.rowCount || 0 };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function recordSyncResult(client, status, count, error) {
  await client.query(
    `INSERT INTO bc_specialist_directory_sync_state
       (id, last_attempt_at, last_success_at, last_status, last_error, specialist_count)
     VALUES (TRUE, NOW(), CASE WHEN $1 = 'OK' THEN NOW() ELSE NULL END, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       last_attempt_at  = NOW(),
       last_success_at  = CASE WHEN $1 = 'OK' THEN NOW() ELSE bc_specialist_directory_sync_state.last_success_at END,
       last_status      = $1,
       last_error       = $2,
       specialist_count = CASE WHEN $1 = 'OK' THEN $3 ELSE bc_specialist_directory_sync_state.specialist_count END`,
    [status, error, count],
  );
}

async function main() {
  const sessionStatePath = process.argv[2] || process.env.PATHWAYS_SESSION_STATE_PATH || "./pathways-session.json";

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  console.log(`Fetching PathwaysBC global data using session ${sessionStatePath} ...`);
  const raw = await fetchPathwaysGlobalData(sessionStatePath);

  console.log("Parsing specialists ...");
  const rows = parsePathwaysGlobalData(raw);
  console.log(`Parsed ${rows.length} specialists.`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : false,
  });

  try {
    console.log("Upserting into bc_specialist_directory ...");
    const result = await syncBcSpecialistDirectory(pool, rows);
    console.log(`Done. Synced ${result.synced}, deactivated ${result.deactivated}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("pathways-sync failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
