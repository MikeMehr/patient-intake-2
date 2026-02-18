-- Migration 014: Track fax status per prescription
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'prescriptions'
  ) THEN
    ALTER TABLE prescriptions
      ADD COLUMN IF NOT EXISTS fax_status VARCHAR(20) NOT NULL DEFAULT 'not_sent',
      ADD COLUMN IF NOT EXISTS fax_error TEXT,
      ADD COLUMN IF NOT EXISTS fax_sent_at TIMESTAMPTZ;
  END IF;
END
$$;

