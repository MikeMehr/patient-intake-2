-- Migration 074: BC specialist directory, mirrored from PathwaysBC.
--
-- Physicians referring a patient need to find a specialist near the patient's city with a
-- current wait time. OSCAR's own consultation-service picker (professionalSpecialists) has
-- neither a city column nor a wait-time column, and only carries the ~1,600 specialists this
-- clinic has hand-added over time — a tiny slice of the ~8,300 PathwaysBC tracks province-wide.
--
-- bc_specialist_directory is therefore GLOBAL, not org-scoped like pharmacy_directory (066):
-- PathwaysBC is one shared province-wide source, not a per-clinic OSCAR mirror, so there is
-- nothing to key it by. Refreshed monthly from the PathwaysBC global data export (see
-- src/lib/pathways/parse.ts + scripts/pathways-sync.js).
--
-- Full contact info (address/phone/fax/email) is NOT in that export — PathwaysBC only renders
-- it on each specialist's own profile page. Fetching all ~8,300 of those up front isn't worth
-- it when most will never be referred to, so bc_specialist_contact_cache is filled lazily, one
-- row at a time, the first time a physician opens that specialist's detail view.
--
-- bc_specialist_oscar_link is per-org (org OSCAR instances have unrelated specId spaces, same
-- reasoning as pharmacy_directory): it tracks whether a given org has actually added a directory
-- specialist into their own OSCAR yet, or has one queued to be added in the next sync run.

CREATE TABLE IF NOT EXISTS bc_specialist_directory (
    id                                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pathways_id                                 INTEGER NOT NULL,
    name                                         TEXT NOT NULL,
    last_name                                    TEXT NOT NULL,
    honorific                                    TEXT,
    specialization                              TEXT NOT NULL,
    city                                        TEXT,
    billing_number                              TEXT,
    wait_time                                   TEXT,
    -- Lower = faster, derived from wait_time at ingest (see parseWaitTimeRank) so "sort by wait
    -- time" is a plain ORDER BY instead of parsing English strings on every request. NULL when
    -- the bucket text didn't parse or the specialist isn't accepting referrals at all.
    wait_time_rank                              SMALLINT,
    accepts_referrals_via_fax                   BOOLEAN NOT NULL DEFAULT FALSE,
    accepts_referrals_via_phone                 BOOLEAN NOT NULL DEFAULT FALSE,
    accepts_referrals_via_provincial_platform   BOOLEAN NOT NULL DEFAULT FALSE,
    is_practicing                               BOOLEAN NOT NULL DEFAULT TRUE,
    -- PathwaysBC's own status icon key (e.g. green_check, blue_arrow) — kept verbatim rather than
    -- reinterpreted, since its exact meanings are defined by PathwaysBC, not us.
    referral_icon_key                           TEXT,
    active                                      BOOLEAN NOT NULL DEFAULT TRUE,
    synced_at                                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at                                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    search_text                                 TEXT GENERATED ALWAYS AS (
                                                     lower(coalesce(name, '') || ' ' || coalesce(specialization, '') || ' ' || coalesce(city, ''))
                                                 ) STORED,
    UNIQUE (pathways_id)
);

-- The directory page's two real query shapes: "specialty + city, sorted by wait time" and a
-- name search. No pg_trgm for the same reason as pharmacy_directory (066) — CREATE EXTENSION
-- needs rights the app role may not have, and run-migrations logs-and-continues on failure.
CREATE INDEX IF NOT EXISTS idx_bc_specialist_directory_filter
    ON bc_specialist_directory (active, specialization, city, wait_time_rank);
CREATE INDEX IF NOT EXISTS idx_bc_specialist_directory_search
    ON bc_specialist_directory (active, search_text);

-- Single-row bookkeeping for the monthly sync (mirrors pharmacy_directory_sync_state's
-- attempt/success split, but there is exactly one directory, not one per org, so the row is
-- pinned to id = TRUE instead of an organization_id primary key).
CREATE TABLE IF NOT EXISTS bc_specialist_directory_sync_state (
    id                BOOLEAN PRIMARY KEY DEFAULT TRUE,
    last_attempt_at   TIMESTAMPTZ,
    last_success_at   TIMESTAMPTZ,
    last_status       TEXT,
    last_error        TEXT,
    specialist_count  INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT bc_specialist_directory_sync_state_singleton CHECK (id)
);

-- Lazily-fetched office contact info, one profile-page scrape per specialist, cached indefinitely
-- (an office move is rare enough that a manual re-fetch trigger is fine — no scheduled refresh).
CREATE TABLE IF NOT EXISTS bc_specialist_contact_cache (
    bc_specialist_id  UUID PRIMARY KEY REFERENCES bc_specialist_directory(id) ON DELETE CASCADE,
    clinic_name       TEXT,
    clinic_address    TEXT,
    phone             TEXT,
    fax               TEXT,
    email             TEXT,
    accepted_by       TEXT,
    responded_by      TEXT,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-org view of "is this directory specialist actually usable in our OSCAR yet". QUEUED rows
-- are picked up by the next monthly OSCAR sync (browser-driven against AddSpecialist.do /
-- UpdateServiceSpecialists.do, same mechanism as the original A-Z migration — OSCAR's mTLS
-- device-cert gate rules out an unattended server-side write). LINKED rows carry the resulting
-- OSCAR specId so the referral UI can skip straight to attaching it.
CREATE TABLE IF NOT EXISTS bc_specialist_oscar_link (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bc_specialist_id          UUID NOT NULL REFERENCES bc_specialist_directory(id) ON DELETE CASCADE,
    status                    TEXT NOT NULL DEFAULT 'QUEUED',
    oscar_spec_id             TEXT,
    oscar_service_name        TEXT,
    requested_by_provider_no  TEXT,
    queued_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synced_at                 TIMESTAMPTZ,
    error_message             TEXT,
    UNIQUE (organization_id, bc_specialist_id)
);

CREATE INDEX IF NOT EXISTS idx_bc_specialist_oscar_link_queue
    ON bc_specialist_oscar_link (organization_id, status)
    WHERE status = 'QUEUED';
