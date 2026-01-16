-- Migration 005: Add form_summary to patient_invitations table
-- Allows physicians to upload form PDFs (school/work/MVA insurance forms) for completion during patient intake

-- Add form_summary column to patient_invitations table
ALTER TABLE patient_invitations 
    ADD COLUMN IF NOT EXISTS form_summary TEXT;

-- Add index for faster queries if needed
CREATE INDEX IF NOT EXISTS idx_patient_invitations_form_summary 
    ON patient_invitations(form_summary) 
    WHERE form_summary IS NOT NULL;















