-- Migration 042: Add PHQ-9/GAD-7 screening flag to patient_invitations
-- Results are stored in the existing history JSONB column in patient_sessions.
ALTER TABLE patient_invitations
  ADD COLUMN IF NOT EXISTS request_phq_gad BOOLEAN NOT NULL DEFAULT FALSE;
