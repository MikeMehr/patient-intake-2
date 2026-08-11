#!/usr/bin/env node
/**
 * Refreshes bc_specialist_directory (migration 074) from PathwaysBC's global data export, by
 * writing directly to a local DATABASE_URL. For production, see scripts/pathways-sync-to-prod.js
 * instead — prod's DB is Azure-firewalled from a laptop, so that one POSTs to a cron endpoint.
 *
 * Fetch/parse logic lives in scripts/pathways-fetch.js, shared with pathways-sync-to-prod.js.
 *
 * Usage: DATABASE_URL=... node scripts/pathways-sync.js [session-state-path]
 *   (session path defaults to PATHWAYS_SESSION_STATE_PATH, or ./pathways-session.json)
 */

const { Pool } = require("pg");
const { parsePathwaysGlobalData, fetchPathwaysGlobalData } = require("./pathways-fetch");

const MIN_PLAUSIBLE_ROWS = 1000;

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
