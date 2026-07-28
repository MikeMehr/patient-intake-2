-- Outbound secure file sharing: clinic sends files to anyone via a passphrase-gated,
-- expiring link. Mirror of the inbound patient_document_requests flow, but the clinic
-- is the sender. File bytes live in Azure Blob Storage (uploaded browser→Azure directly
-- via write-SAS); only the blob path is stored here. The passphrase is bcrypt-hashed and
-- never stored in the clear; the link token is SHA-256 hashed.

CREATE TABLE IF NOT EXISTS document_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  created_by_user_id UUID,
  recipient_name TEXT,
  recipient_email TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  passphrase_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  download_count INTEGER NOT NULL DEFAULT 0,
  last_downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_shares_org
  ON document_shares (organization_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_token
  ON document_shares (token_hash);

CREATE TABLE IF NOT EXISTS document_share_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES document_shares(id) ON DELETE CASCADE,
  blob_path TEXT NOT NULL,
  original_filename TEXT,
  content_type TEXT,
  size_bytes BIGINT,
  uploaded_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_document_share_files_share
  ON document_share_files (share_id);
