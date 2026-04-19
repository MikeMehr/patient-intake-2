-- Add request_pwd_e6f column to patient_invitations for PWD Section E6 & F form
ALTER TABLE patient_invitations
  ADD COLUMN IF NOT EXISTS request_pwd_e6f BOOLEAN NOT NULL DEFAULT FALSE;
