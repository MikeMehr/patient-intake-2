/**
 * Local mirror of PathwaysBC's specialist directory (migration 074).
 *
 * Global rather than org-scoped — see the migration header. Ingestion (turning a parsed
 * PathwaysBC export into stored rows) and the physician-facing search/queue reads below share
 * this module since both operate on the same two tables.
 *
 * bc_specialist_oscar_link tracks, per org, whether a directory specialist has actually been
 * queued/added to that org's own OSCAR. Populated two ways: (1) a physician queues one through
 * the directory UI (queueBcSpecialistForOscar), or (2) the reconciliation job
 * (applyOscarReconciliationMatches, see src/lib/oscar/specialist-reconcile.ts) discovers a
 * name+specialty match against OSCAR's existing roster — since OSCAR has no read API of its own,
 * that roster has to be fetched live via an authenticated browser session and matched here.
 */

import { getClient, query } from "@/lib/db";
import type { NormalizedSpecialist } from "@/lib/pathways/parse";

export type BcSpecialistDirectoryState = {
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  count: number;
};

async function recordSyncAttempt(): Promise<void> {
  await query(
    `INSERT INTO bc_specialist_directory_sync_state (id, last_attempt_at)
     VALUES (TRUE, NOW())
     ON CONFLICT (id) DO UPDATE SET last_attempt_at = NOW()`,
  );
}

async function recordSyncResult(
  status: "OK" | "FAILED",
  count: number,
  error: string | null,
): Promise<void> {
  await query(
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

export async function getBcSpecialistDirectoryState(): Promise<BcSpecialistDirectoryState> {
  const res = await query<{
    last_success_at: Date | null;
    last_attempt_at: Date | null;
    last_status: string | null;
    last_error: string | null;
    specialist_count: number;
  }>(
    `SELECT last_success_at, last_attempt_at, last_status, last_error, specialist_count
     FROM bc_specialist_directory_sync_state WHERE id = TRUE`,
  );
  const row = res.rows[0];
  return {
    lastSuccessAt: row?.last_success_at ?? null,
    lastAttemptAt: row?.last_attempt_at ?? null,
    lastStatus: row?.last_status ?? null,
    lastError: row?.last_error ?? null,
    count: row?.specialist_count ?? 0,
  };
}

/**
 * Replace the directory's contents with a freshly-parsed PathwaysBC export.
 *
 * Upsert-then-deactivate, not delete-then-insert: bc_specialist_oscar_link (per-org) references
 * rows by id, and a specialist who drops out of PathwaysBC's export should stop being offered
 * without orphaning any org's existing link/queue row.
 *
 * Refuses to deactivate anything when the parsed batch is empty or implausibly small — far more
 * likely a broken scrape (session expired, PathwaysBC changed its export shape) than the
 * province's specialist count actually collapsing.
 */
export async function syncBcSpecialistDirectory(
  rows: NormalizedSpecialist[],
): Promise<{ synced: number; deactivated: number } | { error: string }> {
  await recordSyncAttempt();

  const MIN_PLAUSIBLE_ROWS = 1000;
  if (rows.length < MIN_PLAUSIBLE_ROWS) {
    const message = `Parsed only ${rows.length} specialists (expected several thousand) — refusing to sync`;
    console.error(`[pathways-directory] ${message}`);
    await recordSyncResult("FAILED", 0, message);
    return { error: message };
  }

  const client = await getClient();
  try {
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
    await recordSyncResult("OK", rows.length, null);
    return { synced: rows.length, deactivated: deactivated.rowCount ?? 0 };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore — must not mask the original error */
    }
    const message = (err as Error).message.slice(0, 500);
    console.error("[pathways-directory] sync failed:", message);
    await recordSyncResult("FAILED", 0, message);
    return { error: "Failed to store the BC specialist directory" };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Physician-facing reads and the per-org OSCAR queue
// ---------------------------------------------------------------------------------------------

export type BcSpecialistOscarStatus = "QUEUED" | "LINKED" | "FAILED";

export type BcSpecialistRow = {
  id: string;
  pathwaysId: number;
  name: string;
  honorific: string | null;
  specialization: string;
  city: string | null;
  billingNumber: string | null;
  waitTime: string | null;
  waitTimeRank: number | null;
  acceptsReferralsViaFax: boolean;
  acceptsReferralsViaPhone: boolean;
  acceptsReferralsViaProvincialPlatform: boolean;
  referralIconKey: string | null;
  oscarStatus: BcSpecialistOscarStatus | null;
};

type DirectoryDbRow = {
  id: string;
  pathways_id: number;
  name: string;
  honorific: string | null;
  specialization: string;
  city: string | null;
  billing_number: string | null;
  wait_time: string | null;
  wait_time_rank: number | null;
  accepts_referrals_via_fax: boolean;
  accepts_referrals_via_phone: boolean;
  accepts_referrals_via_provincial_platform: boolean;
  referral_icon_key: string | null;
  oscar_status: BcSpecialistOscarStatus | null;
};

function mapRow(r: DirectoryDbRow): BcSpecialistRow {
  return {
    id: r.id,
    pathwaysId: r.pathways_id,
    name: r.name,
    honorific: r.honorific,
    specialization: r.specialization,
    city: r.city,
    billingNumber: r.billing_number,
    waitTime: r.wait_time,
    waitTimeRank: r.wait_time_rank,
    acceptsReferralsViaFax: r.accepts_referrals_via_fax,
    acceptsReferralsViaPhone: r.accepts_referrals_via_phone,
    acceptsReferralsViaProvincialPlatform: r.accepts_referrals_via_provincial_platform,
    referralIconKey: r.referral_icon_key,
    oscarStatus: r.oscar_status,
  };
}

const MIN_QUERY_LEN = 2;
const MAX_QUERY_TOKENS = 6;

/** Same shape as pharmacy-directory.ts's tokenizer — words ANDed so "malek neuro" matches. */
function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_QUERY_LEN)
    .slice(0, MAX_QUERY_TOKENS);
}

export type SpecialistSearchParams = {
  organizationId?: string | null;
  specialty?: string;
  city?: string;
  q?: string;
  sort?: "wait" | "name";
  limit?: number;
};

/**
 * The directory page's one query: optionally filter by specialty/city/name, sort by wait time
 * (fastest first, unknowns last) or name, and annotate each row with this org's OSCAR link
 * status via a LEFT JOIN (organizationId = null naturally yields no match, so solo physicians
 * without an org just see everything as unlinked rather than needing a branch).
 */
export async function searchBcSpecialistDirectory(
  params: SpecialistSearchParams,
): Promise<BcSpecialistRow[]> {
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 200) : 50;
  const conditions: string[] = ["d.active = TRUE"];
  const values: unknown[] = [params.organizationId ?? null];

  if (params.specialty) {
    values.push(params.specialty);
    conditions.push(`d.specialization = $${values.length}`);
  }
  if (params.city) {
    values.push(params.city);
    conditions.push(`d.city = $${values.length}`);
  }
  for (const token of params.q ? tokenizeQuery(params.q) : []) {
    values.push(`%${token.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`d.search_text LIKE $${values.length} ESCAPE '\\'`);
  }

  const orderBy = params.sort === "name" ? "d.name" : "d.wait_time_rank NULLS LAST, d.name";

  values.push(limit);
  const res = await query<DirectoryDbRow>(
    `SELECT d.id, d.pathways_id, d.name, d.honorific, d.specialization, d.city,
            d.billing_number, d.wait_time, d.wait_time_rank, d.accepts_referrals_via_fax,
            d.accepts_referrals_via_phone, d.accepts_referrals_via_provincial_platform,
            d.referral_icon_key, l.status AS oscar_status
     FROM bc_specialist_directory d
     LEFT JOIN bc_specialist_oscar_link l
       ON l.bc_specialist_id = d.id AND l.organization_id = $1
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${orderBy}
     LIMIT $${values.length}`,
    values,
  );
  return res.rows.map(mapRow);
}

export type BcSpecialistDirectoryFacets = {
  specialties: string[];
  cities: string[];
};

/** Populates the filter dropdowns. Cheap: both columns are low-cardinality and indexed. */
export async function getBcSpecialistDirectoryFacets(): Promise<BcSpecialistDirectoryFacets> {
  const [specialties, cities] = await Promise.all([
    query<{ specialization: string }>(
      `SELECT DISTINCT specialization FROM bc_specialist_directory
       WHERE active = TRUE ORDER BY specialization`,
    ),
    query<{ city: string }>(
      `SELECT DISTINCT city FROM bc_specialist_directory
       WHERE active = TRUE AND city IS NOT NULL ORDER BY city`,
    ),
  ]);
  return {
    specialties: specialties.rows.map((r) => r.specialization),
    cities: cities.rows.map((r) => r.city),
  };
}

export type QueueBcSpecialistResult =
  | { outcome: "QUEUED" }
  | { outcome: "ALREADY_QUEUED" }
  | { outcome: "ALREADY_LINKED"; oscarSpecId: string | null }
  | { outcome: "NOT_FOUND" };

/**
 * Mark a directory specialist as wanted in this org's OSCAR. Idempotent — re-queueing an
 * already-queued or already-linked specialist is a no-op that reports the existing state rather
 * than erroring, since the physician-facing button can't easily know which case it's in.
 *
 * Does not touch OSCAR itself — a QUEUED row is picked up by the (not yet built) monthly
 * browser-driven OSCAR sync job.
 */
export async function queueBcSpecialistForOscar(
  organizationId: string,
  bcSpecialistId: string,
  requestedByProviderNo: string | null,
): Promise<QueueBcSpecialistResult> {
  const existing = await query<{ status: BcSpecialistOscarStatus; oscar_spec_id: string | null }>(
    `SELECT status, oscar_spec_id FROM bc_specialist_oscar_link
     WHERE organization_id = $1 AND bc_specialist_id = $2`,
    [organizationId, bcSpecialistId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    return row.status === "LINKED"
      ? { outcome: "ALREADY_LINKED", oscarSpecId: row.oscar_spec_id }
      : { outcome: "ALREADY_QUEUED" };
  }

  const inserted = await query(
    `INSERT INTO bc_specialist_oscar_link (organization_id, bc_specialist_id, status, requested_by_provider_no)
     SELECT $1, id, 'QUEUED', $3 FROM bc_specialist_directory WHERE id = $2 AND active = TRUE
     ON CONFLICT (organization_id, bc_specialist_id) DO NOTHING`,
    [organizationId, bcSpecialistId, requestedByProviderNo],
  );
  return (inserted.rowCount ?? 0) > 0 ? { outcome: "QUEUED" } : { outcome: "NOT_FOUND" };
}

// ---------------------------------------------------------------------------------------------
// OSCAR sync job (browser-driven — see src/lib/oscar/specialist-sync-plan.ts): reads QUEUED
// rows and, once written into OSCAR, records the outcome back onto bc_specialist_oscar_link.
// ---------------------------------------------------------------------------------------------

export type OscarSyncCandidate = {
  linkId: string;
  bcSpecialistId: string;
  pathwaysId: number;
  name: string;
  lastName: string;
  honorific: string | null;
  specialization: string;
  city: string | null;
  billingNumber: string | null;
  requestedByProviderNo: string | null;
  /**
   * From bc_specialist_contact_cache — null until something has fetched it. OSCAR's
   * AddSpecialist.do REJECTS a submission with no phone or no address (confirmed live
   * 2026-08-11: "Please enter Phone" / "Please enter Address"), so a candidate with either
   * missing can't actually be synced yet — see candidateHasRequiredContactInfo in
   * src/lib/oscar/specialist-sync-plan.ts.
   */
  address: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
};

type CandidateDbRow = {
  link_id: string;
  bc_specialist_id: string;
  pathways_id: number;
  name: string;
  last_name: string;
  honorific: string | null;
  specialization: string;
  city: string | null;
  billing_number: string | null;
  requested_by_provider_no: string | null;
  clinic_address: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
};

/** Everything the OSCAR sync job needs for this org's QUEUED specialists, oldest-queued first. */
export async function getQueuedOscarSyncCandidates(organizationId: string): Promise<OscarSyncCandidate[]> {
  const res = await query<CandidateDbRow>(
    `SELECT l.id AS link_id, d.id AS bc_specialist_id, d.pathways_id, d.name, d.last_name,
            d.honorific, d.specialization, d.city, d.billing_number, l.requested_by_provider_no,
            c.clinic_address, c.phone, c.fax, c.email
     FROM bc_specialist_oscar_link l
     JOIN bc_specialist_directory d ON d.id = l.bc_specialist_id
     LEFT JOIN bc_specialist_contact_cache c ON c.bc_specialist_id = d.id
     WHERE l.organization_id = $1 AND l.status = 'QUEUED'
     ORDER BY l.queued_at ASC`,
    [organizationId],
  );
  return res.rows.map((r) => ({
    linkId: r.link_id,
    bcSpecialistId: r.bc_specialist_id,
    pathwaysId: r.pathways_id,
    name: r.name,
    lastName: r.last_name,
    honorific: r.honorific,
    specialization: r.specialization,
    city: r.city,
    billingNumber: r.billing_number,
    requestedByProviderNo: r.requested_by_provider_no,
    address: r.clinic_address,
    phone: r.phone,
    fax: r.fax,
    email: r.email,
  }));
}

export type OscarSyncOutcome =
  | { status: "LINKED"; oscarSpecId: string; oscarServiceName: string }
  | { status: "FAILED"; errorMessage: string };

/** Records what actually happened in OSCAR for one queued link, after the browser-driven run. */
export async function recordOscarSyncOutcome(linkId: string, outcome: OscarSyncOutcome): Promise<void> {
  if (outcome.status === "LINKED") {
    await query(
      `UPDATE bc_specialist_oscar_link
       SET status = 'LINKED', oscar_spec_id = $2, oscar_service_name = $3, synced_at = NOW(), error_message = NULL
       WHERE id = $1`,
      [linkId, outcome.oscarSpecId, outcome.oscarServiceName],
    );
  } else {
    await query(
      `UPDATE bc_specialist_oscar_link
       SET status = 'FAILED', synced_at = NOW(), error_message = $2
       WHERE id = $1`,
      [linkId, outcome.errorMessage.slice(0, 500)],
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Reconciliation against OSCAR's existing (already-added) specialist roster
// ---------------------------------------------------------------------------------------------

export type ReconciliationCandidate = { bcSpecialistId: string; name: string; specialization: string };

/**
 * The full active directory, name-only shape, for the reconciliation job to match against a live
 * OSCAR roster fetch. Not org-scoped by itself — reconciliation results are written per org by
 * applyOscarReconciliationMatches, since OSCAR instances (and therefore specId spaces) are
 * per-org, but the candidate list (what PathwaysBC calls each specialist) is the same for anyone.
 */
export async function getReconciliationCandidates(): Promise<ReconciliationCandidate[]> {
  const res = await query<{ id: string; name: string; specialization: string }>(
    `SELECT id, name, specialization FROM bc_specialist_directory WHERE active = TRUE`,
  );
  return res.rows.map((r) => ({ bcSpecialistId: r.id, name: r.name, specialization: r.specialization }));
}

export type ReconciliationMatchInput = {
  bcSpecialistId: string;
  oscarSpecId: string;
  oscarServiceName: string;
  address: string | null;
  phone: string | null;
  fax: string | null;
};

/**
 * Marks each match LINKED for this org (upgrading QUEUED or creating a fresh row — never
 * downgrades an existing LINKED row, and never touches rows reconciliation didn't match), and
 * opportunistically backfills bc_specialist_contact_cache with the office info the OSCAR read
 * turned up. Contact cache uses DO NOTHING on conflict — reconciliation fills a gap, it doesn't
 * overwrite contact info from a source that might be more current (e.g. a future PathwaysBC
 * profile scrape).
 */
export async function applyOscarReconciliationMatches(
  organizationId: string,
  matches: ReconciliationMatchInput[],
): Promise<{ linked: number }> {
  if (matches.length === 0) return { linked: 0 };

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const linked = await client.query(
      `INSERT INTO bc_specialist_oscar_link (organization_id, bc_specialist_id, status, oscar_spec_id, oscar_service_name, synced_at)
       SELECT $1, t.bc_specialist_id, 'LINKED', t.oscar_spec_id, t.oscar_service_name, NOW()
       FROM unnest($2::uuid[], $3::text[], $4::text[]) AS t(bc_specialist_id, oscar_spec_id, oscar_service_name)
       ON CONFLICT (organization_id, bc_specialist_id) DO UPDATE SET
         status              = 'LINKED',
         oscar_spec_id       = EXCLUDED.oscar_spec_id,
         oscar_service_name  = EXCLUDED.oscar_service_name,
         synced_at           = NOW(),
         error_message       = NULL`,
      [organizationId, matches.map((m) => m.bcSpecialistId), matches.map((m) => m.oscarSpecId), matches.map((m) => m.oscarServiceName)],
    );

    await client.query(
      `INSERT INTO bc_specialist_contact_cache (bc_specialist_id, clinic_address, phone, fax)
       SELECT t.bc_specialist_id, t.address, t.phone, t.fax
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) AS t(bc_specialist_id, address, phone, fax)
       ON CONFLICT (bc_specialist_id) DO NOTHING`,
      [matches.map((m) => m.bcSpecialistId), matches.map((m) => m.address), matches.map((m) => m.phone), matches.map((m) => m.fax)],
    );

    await client.query("COMMIT");
    return { linked: linked.rowCount ?? 0 };
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

// ---------------------------------------------------------------------------------------------
// Contact-info backfill: OSCAR requires phone+address to create a specialist (see
// specialist-sync-plan.ts), so a QUEUED specialist can't actually be synced until
// bc_specialist_contact_cache has something for them. This scrapes PathwaysBC's own profile page
// (src/lib/pathways/profile-parse.ts) for whichever queued specialists are still missing it.
// ---------------------------------------------------------------------------------------------

export type ContactBackfillCandidate = { bcSpecialistId: string; pathwaysId: number };

/**
 * Queued (any org — contact info isn't org-scoped) specialists with no contact_cache row yet.
 * Not "all 8,090 active specialists" on purpose — only ones someone actually asked to be added to
 * OSCAR need this scrape run for them; the rest are reached fine via the PathwaysBC profile link
 * already shown in the directory UI.
 */
export async function getContactBackfillCandidates(): Promise<ContactBackfillCandidate[]> {
  const res = await query<{ bc_specialist_id: string; pathways_id: number }>(
    `SELECT DISTINCT d.id AS bc_specialist_id, d.pathways_id
     FROM bc_specialist_oscar_link l
     JOIN bc_specialist_directory d ON d.id = l.bc_specialist_id
     LEFT JOIN bc_specialist_contact_cache c ON c.bc_specialist_id = d.id
     WHERE l.status = 'QUEUED' AND c.bc_specialist_id IS NULL`,
  );
  return res.rows.map((r) => ({ bcSpecialistId: r.bc_specialist_id, pathwaysId: r.pathways_id }));
}

export type ContactBackfillResult = {
  bcSpecialistId: string;
  phone: string | null;
  fax: string | null;
  email: string | null;
  clinicAddress: string | null;
  acceptedBy: string | null;
  respondedBy: string | null;
};

/**
 * Authoritative upsert (unlike the reconciliation job's opportunistic DO NOTHING) — this job's
 * entire purpose is populating/refreshing contact info, so a re-run intentionally overwrites a
 * stale row rather than leaving it.
 */
export async function applyContactBackfill(results: ContactBackfillResult[]): Promise<{ updated: number }> {
  if (results.length === 0) return { updated: 0 };

  const res = await query(
    `INSERT INTO bc_specialist_contact_cache
       (bc_specialist_id, phone, fax, email, clinic_address, accepted_by, responded_by, fetched_at)
     SELECT t.bc_specialist_id, t.phone, t.fax, t.email, t.clinic_address, t.accepted_by, t.responded_by, NOW()
     FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
       AS t(bc_specialist_id, phone, fax, email, clinic_address, accepted_by, responded_by)
     ON CONFLICT (bc_specialist_id) DO UPDATE SET
       phone         = EXCLUDED.phone,
       fax           = EXCLUDED.fax,
       email         = EXCLUDED.email,
       clinic_address = EXCLUDED.clinic_address,
       accepted_by   = EXCLUDED.accepted_by,
       responded_by  = EXCLUDED.responded_by,
       fetched_at    = NOW()`,
    [
      results.map((r) => r.bcSpecialistId),
      results.map((r) => r.phone),
      results.map((r) => r.fax),
      results.map((r) => r.email),
      results.map((r) => r.clinicAddress),
      results.map((r) => r.acceptedBy),
      results.map((r) => r.respondedBy),
    ],
  );
  return { updated: res.rowCount ?? 0 };
}
