-- Migration 023: Persist patient DOB on invitations for chart matching

ALTER TABLE patient_invitations
  ADD COLUMN IF NOT EXISTS patient_dob DATE;

CREATE INDEX IF NOT EXISTS idx_patient_invitations_patient_dob
  ON patient_invitations(patient_dob)
  WHERE patient_dob IS NOT NULL;
