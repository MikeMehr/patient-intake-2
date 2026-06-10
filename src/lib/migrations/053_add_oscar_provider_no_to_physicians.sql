-- Migration 053: Map each physician to their OSCAR provider number.
-- Needed so online bookings can be written to the correct provider's OSCAR schedule.
ALTER TABLE physicians ADD COLUMN IF NOT EXISTS oscar_provider_no TEXT;
