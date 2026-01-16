-- Migration 001: Create patient_invitations table
-- Stores patient invitation data including lab report summaries

CREATE TABLE IF NOT EXISTS patient_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    physician_id UUID NOT NULL REFERENCES physicians(id) ON DELETE CASCADE,
    patient_name VARCHAR(255) NOT NULL,
    patient_email VARCHAR(255) NOT NULL,
    invitation_link TEXT NOT NULL,
    lab_report_summary TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(physician_id, patient_email, invitation_link)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_patient_invitations_physician_id 
    ON patient_invitations(physician_id);

CREATE INDEX IF NOT EXISTS idx_patient_invitations_patient_email 
    ON patient_invitations(patient_email);

CREATE INDEX IF NOT EXISTS idx_patient_invitations_lab_report_summary 
    ON patient_invitations(lab_report_summary) 
    WHERE lab_report_summary IS NOT NULL;
















