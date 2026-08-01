-- Migration 066: Preferred pharmacy captured at online-booking intake.
--
-- pharmacy_directory is a local mirror of OSCAR's `pharmacyInfo` table (1516 BC pharmacies),
-- pulled through the pharmacy bridge. It exists so the patient-facing typeahead searches our own
-- database instead of reaching across to the clinic on every keystroke, and so the id we send
-- back to OSCAR is guaranteed to be one OSCAR already knows.
--
-- Org-scoped because emr_connections is (migration 047) — two organizations on different OSCAR
-- instances have unrelated recordID spaces, so a global table would collide.
--
-- appointments.pharmacy_link_status: 'LINKED' (set as preferred in OSCAR), 'FAILED' (bridge
-- errored), 'SKIPPED' (no OSCAR chart, bridge not configured, or a free-text pharmacy that has
-- no OSCAR id to link). NULL when the patient chose no pharmacy. Deliberately not the same
-- vocabulary as oscar_sync_status, which answers a different question (did the *appointment*
-- reach the day sheet).

CREATE TABLE IF NOT EXISTS pharmacy_directory (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    oscar_pharmacy_id TEXT NOT NULL,
    name              TEXT NOT NULL,
    address           TEXT,
    city              TEXT,
    province          TEXT,
    postal_code       TEXT,
    phone             TEXT,
    fax               TEXT,
    email             TEXT,
    active            BOOLEAN NOT NULL DEFAULT TRUE,
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    search_text       TEXT GENERATED ALWAYS AS (
                          lower(coalesce(name, '') || ' ' || coalesce(address, '') || ' ' || coalesce(city, ''))
                      ) STORED,
    UNIQUE (organization_id, oscar_pharmacy_id)
);

-- Supports the typeahead's prefix matches. No pg_trgm: CREATE EXTENSION needs rights the app role
-- may not have, and run-migrations logs-and-continues on failure, which would leave a silently
-- missing index. At ~1500 rows per org an ILIKE scan is sub-millisecond anyway.
CREATE INDEX IF NOT EXISTS idx_pharmacy_directory_search
    ON pharmacy_directory (organization_id, active, search_text);

-- Separate from MAX(synced_at) so "never synced" is distinguishable from "sync failed", and so
-- last_attempt_at can act as a cheap lock stopping concurrent searches each firing a full pull.
CREATE TABLE IF NOT EXISTS pharmacy_directory_sync_state (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    last_attempt_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_status     TEXT,
    last_error      TEXT,
    pharmacy_count  INTEGER NOT NULL DEFAULT 0
);

-- The patient's choice, snapshotted onto the booking. Columns rather than a side table because
-- this is strictly 1:1 and matches how oscar_demographic_no (040) and the oscar_sync_* columns
-- (054) are already stored — it also persists for free inside confirmAppointment's single CTE.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pharmacy_oscar_id    TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pharmacy_name        TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pharmacy_address     TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pharmacy_city        TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pharmacy_phone       TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pharmacy_fax         TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pharmacy_source      TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pharmacy_link_status TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pharmacy_link_error  TEXT;
