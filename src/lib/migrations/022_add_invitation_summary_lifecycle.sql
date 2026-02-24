-- Migration 022: Add lifecycle controls for invitation PDF summaries
-- Adds explicit expiry + deletion markers used to bound PHI retention.

ALTER TABLE patient_invitations
  ADD COLUMN IF NOT EXISTS summary_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS summary_deleted_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_patient_invitations_summary_expires_at
  ON patient_invitations(summary_expires_at)
  WHERE summary_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_invitations_summary_deleted_at
  ON patient_invitations(summary_deleted_at)
  WHERE summary_deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_invitations_summary_active_window
  ON patient_invitations(summary_expires_at, summary_deleted_at)
  WHERE summary_expires_at IS NOT NULL;
