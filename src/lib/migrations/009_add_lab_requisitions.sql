-- Lab requisitions linked to patient_sessions
CREATE TABLE IF NOT EXISTS lab_requisitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_code VARCHAR(255) NOT NULL REFERENCES patient_sessions(session_code) ON DELETE CASCADE,
    patient_name VARCHAR(255) NOT NULL,
    patient_email VARCHAR(255) NOT NULL,
    physician_name VARCHAR(255),
    clinic_name VARCHAR(255),
    clinic_address TEXT,
    labs JSONB NOT NULL,
    additional_instructions TEXT,
    pdf_bytes BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_requisitions_session_code ON lab_requisitions(session_code);
CREATE INDEX IF NOT EXISTS idx_lab_requisitions_created_at ON lab_requisitions(created_at DESC);

