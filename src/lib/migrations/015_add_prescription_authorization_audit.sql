-- Migration 015: Prescription authorization status and audit metadata
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'prescriptions'
  ) THEN
    ALTER TABLE prescriptions
      ADD COLUMN IF NOT EXISTS prescription_status VARCHAR(32) NOT NULL DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS attestation_text TEXT,
      ADD COLUMN IF NOT EXISTS attested_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS authorized_by VARCHAR(255),
      ADD COLUMN IF NOT EXISTS authorized_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS content_hash VARCHAR(128);
  END IF;
END
$$;

