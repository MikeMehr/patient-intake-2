-- Migration 054: Track whether a booked appointment was pushed into OSCAR EMR.
-- oscar_sync_status: 'SYNCED' (created in OSCAR), 'FAILED' (write errored),
-- 'SKIPPED' (no OSCAR connection / missing provider or demographic). NULL until attempted.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS oscar_appointment_no TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS oscar_sync_status TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS oscar_sync_error TEXT;
