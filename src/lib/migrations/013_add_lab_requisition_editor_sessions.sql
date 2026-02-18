CREATE TABLE IF NOT EXISTS lab_requisition_editor_sessions (
    token VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    physician_id UUID NOT NULL REFERENCES physicians(id) ON DELETE CASCADE,
    session_code VARCHAR(255) NOT NULL REFERENCES patient_sessions(session_code) ON DELETE CASCADE,
    source_requisition_id UUID REFERENCES lab_requisitions(id) ON DELETE SET NULL,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lab_req_editor_sessions_physician
    ON lab_requisition_editor_sessions (physician_id);

CREATE INDEX IF NOT EXISTS idx_lab_req_editor_sessions_expiry
    ON lab_requisition_editor_sessions (expires_at);

