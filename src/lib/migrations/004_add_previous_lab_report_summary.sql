-- Migration 004: Add previous_lab_report_summary to patient_invitations table
-- Allows physicians to upload a previous lab report PDF for comparison with the current lab report

-- Add previous_lab_report_summary column to patient_invitations table
ALTER TABLE patient_invitations 
    ADD COLUMN IF NOT EXISTS previous_lab_report_summary TEXT;

-- Add index for faster queries if needed
CREATE INDEX IF NOT EXISTS idx_patient_invitations_previous_lab_report_summary 
    ON patient_invitations(previous_lab_report_summary) 
    WHERE previous_lab_report_summary IS NOT NULL;















