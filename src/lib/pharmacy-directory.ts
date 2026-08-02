/**
 * Local mirror of OSCAR's pharmacy directory.
 *
 * The patient-facing typeahead searches this table rather than reaching across to the clinic on
 * every keystroke, and the id it returns is one OSCAR already knows — so the link write at the end
 * of booking can't fail on an unknown pharmacy.
 *
 * Kept separate from @/lib/oscar/pharmacy because everything under src/lib/oscar/ is transport.
 */

import { getClient, query } from "@/lib/db";
import { listOscarPharmacies, type PharmacyBridgeError } from "@/lib/oscar/pharmacy";

export type PharmacyDirectoryRow = {
  oscarPharmacyId: string;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
  fax: string | null;
};

export type PharmacyDirectoryState = {
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  count: number;
};

const DEFAULT_SEARCH_LIMIT = 10;
const MIN_QUERY_LEN = 2;
// Bounds the number of ANDed LIKEs a single query can build. Six words is far more than a real
// "name + city" search needs.
const MAX_QUERY_TOKENS = 6;

function maxAgeDays(): number {
  const raw = Number(process.env.PHARMACY_DIRECTORY_MAX_AGE_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

type DirectoryDbRow = {
  oscar_pharmacy_id: string;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  phone: string | null;
  fax: string | null;
};

function mapRow(r: DirectoryDbRow): PharmacyDirectoryRow {
  return {
    oscarPharmacyId: r.oscar_pharmacy_id,
    name: r.name,
    address: r.address,
    city: r.city,
    province: r.province,
    postalCode: r.postal_code,
    phone: r.phone,
    fax: r.fax,
  };
}

const SELECT_COLUMNS = `oscar_pharmacy_id, name, address, city, province, postal_code, phone, fax`;

async function recordSyncAttempt(orgId: string): Promise<void> {
  await query(
    `INSERT INTO pharmacy_directory_sync_state (organization_id, last_attempt_at)
     VALUES ($1, NOW())
     ON CONFLICT (organization_id) DO UPDATE SET last_attempt_at = NOW()`,
    [orgId],
  );
}

async function recordSyncResult(
  orgId: string,
  status: "OK" | "FAILED",
  count: number,
  error: string | null,
): Promise<void> {
  await query(
    `INSERT INTO pharmacy_directory_sync_state
       (organization_id, last_attempt_at, last_success_at, last_status, last_error, pharmacy_count)
     VALUES ($1, NOW(), CASE WHEN $2 = 'OK' THEN NOW() ELSE NULL END, $2, $3, $4)
     ON CONFLICT (organization_id) DO UPDATE SET
       last_attempt_at = NOW(),
       last_success_at = CASE WHEN $2 = 'OK' THEN NOW() ELSE pharmacy_directory_sync_state.last_success_at END,
       last_status     = $2,
       last_error      = $3,
       pharmacy_count  = CASE WHEN $2 = 'OK' THEN $4 ELSE pharmacy_directory_sync_state.pharmacy_count END`,
    [orgId, status, error, count],
  );
}

/**
 * Pull the clinic's pharmacy directory from OSCAR and mirror it locally.
 *
 * Upsert-then-deactivate rather than delete-then-insert: appointments reference pharmacies by
 * oscar_pharmacy_id, and a pharmacy that leaves OSCAR's list should stop being offered without the
 * historical row losing its meaning.
 */
export async function syncPharmacyDirectoryForOrg(
  orgId: string,
): Promise<{ synced: number; deactivated: number } | PharmacyBridgeError> {
  await recordSyncAttempt(orgId);

  const result = await listOscarPharmacies(orgId);
  if ("error" in result) {
    await recordSyncResult(orgId, "FAILED", 0, result.error.slice(0, 500));
    return result;
  }

  // A successful call that returns nothing is far more likely to be a broken bridge than a clinic
  // that deleted all 1516 pharmacies. Deactivating on it would silently empty the picker.
  if (result.pharmacies.length === 0) {
    const message = "Pharmacy bridge returned an empty directory — refusing to deactivate";
    console.error(`[pharmacy-directory] ${message} (org ${orgId})`);
    await recordSyncResult(orgId, "FAILED", 0, message);
    return { error: message, status: 502 };
  }

  const p = result.pharmacies;
  const client = await getClient();
  try {
    await client.query("BEGIN");

    // One round trip for all ~1500 rows. synced_at is set explicitly from a single timestamp so
    // the deactivation pass below can key off "not touched by this run".
    const syncedAt = new Date();
    await client.query(
      `INSERT INTO pharmacy_directory
         (organization_id, oscar_pharmacy_id, name, address, city, province, postal_code, phone, fax, email, active, synced_at)
       SELECT $1, t.id, t.name, t.address, t.city, t.province, t.postal, t.phone, t.fax, t.email, TRUE, $11
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])
         AS t(id, name, address, city, province, postal, phone, fax, email)
       ON CONFLICT (organization_id, oscar_pharmacy_id) DO UPDATE SET
         name        = EXCLUDED.name,
         address     = EXCLUDED.address,
         city        = EXCLUDED.city,
         province    = EXCLUDED.province,
         postal_code = EXCLUDED.postal_code,
         phone       = EXCLUDED.phone,
         fax         = EXCLUDED.fax,
         email       = EXCLUDED.email,
         active      = TRUE,
         synced_at   = EXCLUDED.synced_at`,
      [
        orgId,
        p.map((x) => x.pharmacyId),
        p.map((x) => x.name),
        p.map((x) => x.address),
        p.map((x) => x.city),
        p.map((x) => x.province),
        p.map((x) => x.postalCode),
        p.map((x) => x.phone),
        p.map((x) => x.fax),
        p.map((x) => x.email),
        syncedAt,
      ],
    );

    const deactivated = await client.query(
      `UPDATE pharmacy_directory SET active = FALSE
       WHERE organization_id = $1 AND active = TRUE AND synced_at < $2`,
      [orgId, syncedAt],
    );

    await client.query("COMMIT");
    await recordSyncResult(orgId, "OK", p.length, null);
    return { synced: p.length, deactivated: deactivated.rowCount ?? 0 };
  } catch (err) {
    // A failing ROLLBACK must not mask the original error that got us here.
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const message = (err as Error).message.slice(0, 500);
    console.error(`[pharmacy-directory] sync failed for org ${orgId}:`, message);
    await recordSyncResult(orgId, "FAILED", 0, message);
    return { error: "Failed to store the pharmacy directory", status: 500 };
  } finally {
    client.release();
  }
}

/**
 * Break a query into words to match independently.
 *
 * Patients type "shoppers drug mart, burnaby" — name and city together. Those never appear as one
 * contiguous string in search_text (the city may even live in the address column, e.g.
 * "30 - 4429 Kingsway, Burnaby"), so a single LIKE '%…%' can't match. Each word is matched
 * separately and ANDed instead.
 *
 * Punctuation is dropped rather than escaped so "#2127", "shoppers, burnaby" and "st." all behave.
 * Single characters are dropped — they match nearly everything and only cost a scan.
 */
export function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_QUERY_LEN)
    .slice(0, MAX_QUERY_TOKENS);
}

/** Search the mirror. Returns [] when the query has no usable words, without hitting the DB. */
export async function searchPharmacyDirectory(
  orgId: string,
  q: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): Promise<PharmacyDirectoryRow[]> {
  const tokens = tokenizeQuery(q);
  if (tokens.length === 0) return [];

  // Escaping still matters: a token can't reach here with % or _ after tokenizing, but the
  // ESCAPE clause keeps that true if the tokenizer is ever loosened.
  const conditions = tokens.map((_, i) => `search_text LIKE $${i + 2} ESCAPE '\\'`).join(" AND ");
  const params: unknown[] = [orgId, ...tokens.map((t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`)];
  params.push(limit);

  const res = await query<DirectoryDbRow>(
    `SELECT ${SELECT_COLUMNS} FROM pharmacy_directory
     WHERE organization_id = $1 AND active = TRUE AND ${conditions}
     ORDER BY name
     LIMIT $${params.length}`,
    params,
  );
  return res.rows.map(mapRow);
}

/**
 * Look up one pharmacy by its OSCAR id.
 *
 * Load-bearing for trust: when the booking form claims a directory pharmacy, the server snapshots
 * the name/address/fax from here by id and ignores whatever the client sent. Otherwise the public
 * booking form would be a way to write an attacker-chosen fax number onto a chart.
 */
export async function getPharmacyFromDirectory(
  orgId: string,
  oscarPharmacyId: string,
): Promise<PharmacyDirectoryRow | null> {
  const res = await query<DirectoryDbRow>(
    `SELECT ${SELECT_COLUMNS} FROM pharmacy_directory
     WHERE organization_id = $1 AND oscar_pharmacy_id = $2 AND active = TRUE
     LIMIT 1`,
    [orgId, oscarPharmacyId],
  );
  const row = res.rows[0];
  return row ? mapRow(row) : null;
}

/** Exact name (+ city) match, used to rescue a free-text entry that is really a known pharmacy. */
export async function findPharmacyByNameCity(
  orgId: string,
  name: string,
  city?: string,
): Promise<PharmacyDirectoryRow | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const res = await query<DirectoryDbRow>(
    `SELECT ${SELECT_COLUMNS} FROM pharmacy_directory
     WHERE organization_id = $1 AND active = TRUE
       AND lower(name) = lower($2)
       AND ($3::text IS NULL OR lower(coalesce(city, '')) = lower($3))
     ORDER BY name
     LIMIT 1`,
    [orgId, trimmed, city?.trim() || null],
  );
  const row = res.rows[0];
  return row ? mapRow(row) : null;
}

export async function getPharmacyDirectoryState(orgId: string): Promise<PharmacyDirectoryState> {
  const res = await query<{
    last_success_at: Date | null;
    last_attempt_at: Date | null;
    last_status: string | null;
    last_error: string | null;
    pharmacy_count: number;
  }>(
    `SELECT last_success_at, last_attempt_at, last_status, last_error, pharmacy_count
     FROM pharmacy_directory_sync_state WHERE organization_id = $1`,
    [orgId],
  );
  const row = res.rows[0];
  return {
    lastSuccessAt: row?.last_success_at ?? null,
    lastAttemptAt: row?.last_attempt_at ?? null,
    lastStatus: row?.last_status ?? null,
    lastError: row?.last_error ?? null,
    count: row?.pharmacy_count ?? 0,
  };
}

/**
 * Whether a background refresh is worth scheduling: the directory is missing or stale, and no other
 * request started one in the last five minutes. The attempt timestamp doubles as the lock, so a
 * burst of typeahead requests against a cold table fires one sync, not one per keystroke.
 */
export function shouldRefreshDirectory(state: PharmacyDirectoryState): boolean {
  const now = Date.now();
  if (state.lastAttemptAt && now - state.lastAttemptAt.getTime() < 5 * 60_000) return false;
  if (!state.lastSuccessAt) return true;
  return now - state.lastSuccessAt.getTime() > maxAgeDays() * 24 * 60 * 60_000;
}
