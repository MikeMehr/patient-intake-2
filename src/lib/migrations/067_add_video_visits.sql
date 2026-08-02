-- Migration 067: Video virtual visits.
--
-- Until now telehealth meant a phone call: booking_settings.appointment_modality (065) said
-- how *every* appointment at a clinic happens, and VIDEO was a label with nothing behind it.
-- This migration does two things — makes the modality a per-appointment fact so a clinic can
-- run phone and video side by side, and adds the room bookkeeping the video feature needs.

-- ── Per-appointment modality ────────────────────────────────────────────────────────────────
-- Deliberately NULLable with no default. NULL means "inherit the clinic setting", resolved at
-- read time by resolveEffectiveModality(). A NOT NULL DEFAULT 'PHONE' would have to backfill
-- every existing row to PHONE, which silently mislabels every appointment at a clinic whose
-- booking_settings.appointment_modality is already VIDEO or IN_PERSON.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_modality TEXT;

-- The patient's phone was already collected during booking but only forwarded to OSCAR
-- demographic creation, never kept. A video visit needs it to text the join link, and a phone
-- visit *is* it. Plaintext, matching invitations.patient_phone (055) rather than the _enc
-- convention used for health card numbers — a phone number is not on its own identifying the
-- way a PHN is, and keeping it readable is what lets the day-sheet UI prefill a send-link
-- destination without a decrypt on every list query.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_phone TEXT;

-- ── Clinic settings ─────────────────────────────────────────────────────────────────────────
-- appointment_modality (065) keeps its column but demotes from "the only source of truth" to
-- "the default we preselect, and the fallback when the appointment row says nothing".
ALTER TABLE booking_settings
  ADD COLUMN IF NOT EXISTS video_visits_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE booking_settings
  ADD COLUMN IF NOT EXISTS patient_may_choose_modality BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Video visits ────────────────────────────────────────────────────────────────────────────
-- A row is one video consultation: a Daily room plus the patient's join credential.
--
-- Two ways in, hence two nullable keys. An online booking creates the row against
-- appointment_id. But the provider's day-sheet button fires for *any* OSCAR appointment,
-- including the ones staff typed straight into OSCAR that have no row in `appointments` at
-- all — those are keyed by oscar_appointment_no instead.
--
-- oscar_appointment_no is a key *within a tenant*, never an authorization input: every lookup
-- pairs it with organization_id taken from the caller's session. Two clinics on separate OSCAR
-- instances have overlapping appointment-number spaces and must not be able to reach each
-- other's rooms.
CREATE TABLE IF NOT EXISTS video_visits (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Exactly one of these identifies the visit; both may be set once an app-booked
    -- appointment has synced to OSCAR and we learn its appointment number.
    appointment_id           UUID REFERENCES appointments(id) ON DELETE CASCADE,
    oscar_appointment_no     TEXT,

    physician_id             UUID REFERENCES physicians(id) ON DELETE SET NULL,

    -- Daily.co room. The URL is stored because it is what the client iframe loads, but it is
    -- never returned by the public validation endpoint — only by the join endpoint, and only
    -- inside the join window.
    daily_room_name          TEXT NOT NULL,
    daily_room_url           TEXT NOT NULL,
    room_expires_at          TIMESTAMPTZ NOT NULL,

    -- Patient's join credential. SHA-256 at rest, same pattern as manage/document tokens.
    patient_join_token_hash  TEXT NOT NULL,
    patient_join_expires_at  TIMESTAMPTZ NOT NULL,

    -- Copied from the appointment/slot so the join-window check and the waiting-room countdown
    -- need no join. NULL for OSCAR-only visits, where we don't know the time — those stay
    -- joinable until the token expires.
    scheduled_start_at       TIMESTAMPTZ,
    scheduled_end_at         TIMESTAMPTZ,

    patient_display_name     TEXT,
    oscar_demographic_no     TEXT,

    status                   TEXT NOT NULL DEFAULT 'ACTIVE',

    -- Presence is deliberately a pair of heartbeats, not a pair of booleans. A boolean set on
    -- first load stays true after the patient closes the tab, so the provider would see
    -- "patient is waiting" for someone who left. Freshness of *_last_seen_at is the signal;
    -- *_first_joined_at is kept only for the audit trail.
    provider_first_joined_at TIMESTAMPTZ,
    provider_last_seen_at    TIMESTAMPTZ,
    patient_first_joined_at  TIMESTAMPTZ,
    patient_last_seen_at     TIMESTAMPTZ,
    ended_at                 TIMESTAMPTZ,

    -- Who was sent the join link and when. The destination itself is never stored — it is PHI
    -- adjacent and the audit log records the channel only.
    link_send_count          INTEGER NOT NULL DEFAULT 0,
    link_last_sent_at        TIMESTAMPTZ,
    link_last_channel        TEXT,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_video_visits_status
      CHECK (status IN ('ACTIVE', 'ENDED', 'CANCELLED')),
    CONSTRAINT chk_video_visits_has_key
      CHECK (appointment_id IS NOT NULL OR oscar_appointment_no IS NOT NULL)
);

-- Partial unique indexes, NOT table-level UNIQUE. Both keys are nullable and Postgres treats
-- every NULL as distinct, so a plain UNIQUE (appointment_id) would happily allow unlimited
-- OSCAR-only rows (all NULL there) to sit alongside each other enforcing nothing — and the
-- same for app-booked rows under UNIQUE (organization_id, oscar_appointment_no). The WHERE
-- clause is what makes each constraint apply only to the rows it is actually about.
CREATE UNIQUE INDEX IF NOT EXISTS uq_video_visits_room
    ON video_visits (daily_room_name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_video_visits_token
    ON video_visits (patient_join_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_video_visits_appt
    ON video_visits (appointment_id)
    WHERE appointment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_video_visits_oscar_appt
    ON video_visits (organization_id, oscar_appointment_no)
    WHERE oscar_appointment_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_video_visits_org_time
    ON video_visits (organization_id, scheduled_start_at DESC);
