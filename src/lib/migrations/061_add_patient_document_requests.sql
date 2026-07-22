-- Secure patient document upload: emailed link + uploaded files.
-- One request per emailed link; many files per request. File bytes live in
-- Azure Blob Storage — only the blob path is stored here.

CREATE TABLE IF NOT EXISTS patient_document_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  created_by_user_id UUID,
  patient_name TEXT NOT NULL,
  patient_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_document_requests_org
  ON patient_document_requests (organization_id);
CREATE INDEX IF NOT EXISTS idx_patient_document_requests_token
  ON patient_document_requests (token_hash);

CREATE TABLE IF NOT EXISTS patient_document_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES patient_document_requests(id) ON DELETE CASCADE,
  blob_path TEXT NOT NULL,
  original_filename TEXT,
  content_type TEXT,
  size_bytes BIGINT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_patient_document_files_request
  ON patient_document_files (request_id);
