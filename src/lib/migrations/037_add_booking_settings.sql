-- Migration 037: Create booking_settings table
-- One row per organization. Stores all configurable options for online booking.

CREATE TABLE IF NOT EXISTS booking_settings (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  online_booking_enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
  public_booking_start        TIME        NOT NULL DEFAULT '07:00',
  public_booking_end          TIME        NOT NULL DEFAULT '22:00',
  enforce_booking_window      BOOLEAN     NOT NULL DEFAULT TRUE,
  slot_interval_minutes       INTEGER     NOT NULL DEFAULT 15,
  health_card_required        BOOLEAN     NOT NULL DEFAULT FALSE,
  show_blocked_slots          BOOLEAN     NOT NULL DEFAULT FALSE,
  cancellation_policy         TEXT,
  booking_instructions        TEXT,
  timezone                    VARCHAR     NOT NULL DEFAULT 'America/Vancouver',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
