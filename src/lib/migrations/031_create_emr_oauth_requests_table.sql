-- Migration 031: ensure OSCAR OAuth request state table exists for claim-bound callback validation

CREATE TABLE IF NOT EXISTS emr_oauth_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor VARCHAR(32) NOT NULL,
  state VARCHAR(255) NOT NULL,
  request_token VARCHAR(255) NOT NULL,
  request_token_secret_enc TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  token_iss VARCHAR(255),
  token_aud VARCHAR(255),
  token_type VARCHAR(64),
  token_context VARCHAR(128),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emr_oauth_requests_vendor_state
  ON emr_oauth_requests(vendor, state);

CREATE INDEX IF NOT EXISTS idx_emr_oauth_requests_vendor_request_token
  ON emr_oauth_requests(vendor, request_token, expires_at);
