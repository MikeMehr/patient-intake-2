-- Prescriptions linked to patient_sessions
CREATE TABLE IF NOT EXISTS prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_code VARCHAR(255) NOT NULL REFERENCES patient_sessions(session_code) ON DELETE CASCADE,
    patient_name VARCHAR(255) NOT NULL,
    patient_email VARCHAR(255) NOT NULL,
    physician_name VARCHAR(255),
    clinic_name VARCHAR(255),
    clinic_address TEXT,
    medication VARCHAR(255) NOT NULL,
    strength VARCHAR(255),
    sig TEXT NOT NULL,
    quantity VARCHAR(64),
    refills VARCHAR(64),
    notes TEXT,
    pdf_bytes BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_session_code ON prescriptions(session_code);
CREATE INDEX IF NOT EXISTS idx_prescriptions_created_at ON prescriptions(created_at DESC);

