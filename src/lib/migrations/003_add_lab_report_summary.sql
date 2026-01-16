-- Migration 003: Add lab_report_summary to patient_invitations table
-- Allows physicians to upload lab report PDFs when inviting patients

-- Add lab_report_summary column to patient_invitations table
ALTER TABLE patient_invitations 
    ADD COLUMN IF NOT EXISTS lab_report_summary TEXT;

-- Add index for faster queries if needed
CREATE INDEX IF NOT EXISTS idx_patient_invitations_lab_report_summary 
    ON patient_invitations(lab_report_summary) 
    WHERE lab_report_summary IS NOT NULL;
















