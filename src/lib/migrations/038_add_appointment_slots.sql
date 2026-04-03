-- Migration 038: Create appointment_slots table
-- Represents individual bookable time windows per physician.
-- status: OPEN | BLOCKED | HELD | BOOKED
-- held_until / held_session_key: used for the 5-minute checkout hold.

CREATE TABLE IF NOT EXISTS appointment_slots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  physician_id      UUID        NOT NULL REFERENCES physicians(id) ON DELETE CASCADE,
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ NOT NULL,
  status            VARCHAR     NOT NULL DEFAULT 'OPEN',
  held_until        TIMESTAMPTZ,
  held_session_key  VARCHAR,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_slot_status CHECK (status IN ('OPEN', 'BLOCKED', 'HELD', 'BOOKED')),
  CONSTRAINT chk_slot_times  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_slots_org_phys_time
  ON appointment_slots (organization_id, physician_id, start_time);

CREATE INDEX IF NOT EXISTS idx_slots_status_held
  ON appointment_slots (status, held_until)
  WHERE status = 'HELD';
