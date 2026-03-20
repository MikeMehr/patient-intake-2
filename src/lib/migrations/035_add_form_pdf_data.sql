-- Migration 035: Store original form PDF bytes for filled-form download
-- The form_pdf_data column retains the uploaded PDF until the physician downloads
-- the filled version. It follows a separate lifecycle from the 1-hour text summaries
-- (form_pdf_deleted_at) so it remains available after the patient completes the interview.

ALTER TABLE patient_invitations
  ADD COLUMN IF NOT EXISTS form_pdf_data      BYTEA,
  ADD COLUMN IF NOT EXISTS form_pdf_filename  TEXT,
  ADD COLUMN IF NOT EXISTS form_pdf_deleted_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_patient_invitations_form_pdf_deleted_at
  ON patient_invitations (form_pdf_deleted_at)
  WHERE form_pdf_deleted_at IS NOT NULL;
