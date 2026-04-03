-- Migration 039: Create appointments table
-- Stores confirmed bookings. health_card_number_enc is AES-256-GCM encrypted
-- at the application layer (same pattern as hin_enc on patients table).
-- manage_token_hash allows patients to view/cancel via a tokenized link.

CREATE TABLE IF NOT EXISTS appointments (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES organizations(id),
  physician_id            UUID        NOT NULL REFERENCES physicians(id),
  slot_id                 UUID        NOT NULL UNIQUE REFERENCES appointment_slots(id),
  first_name              TEXT        NOT NULL,
  last_name               TEXT        NOT NULL,
  date_of_birth           DATE        NOT NULL,
  email                   TEXT        NOT NULL,
  coverage_type           VARCHAR     NOT NULL,
  province                VARCHAR,
  health_card_number_enc  TEXT,
  billing_note            TEXT,
  manage_token_hash       TEXT        NOT NULL UNIQUE,
  manage_token_expires_at TIMESTAMPTZ NOT NULL,
  cancelled_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_coverage_type CHECK (
    coverage_type IN ('CANADIAN_HEALTH_CARD', 'PRIVATE_PAY', 'TRAVEL_INSURANCE', 'UNINSURED')
  )
);

CREATE INDEX IF NOT EXISTS idx_appointments_org
  ON appointments (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_token
  ON appointments (manage_token_hash);

CREATE INDEX IF NOT EXISTS idx_appointments_physician
  ON appointments (physician_id, created_at DESC);
