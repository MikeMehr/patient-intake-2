-- Migration 018: Persist OSCAR demographicNo on invitations (for patient identity linkage)

ALTER TABLE patient_invitations
  ADD COLUMN IF NOT EXISTS oscar_demographic_no TEXT;

CREATE INDEX IF NOT EXISTS idx_patient_invitations_oscar_demographic_no
  ON patient_invitations(oscar_demographic_no)
  WHERE oscar_demographic_no IS NOT NULL AND oscar_demographic_no <> '';

