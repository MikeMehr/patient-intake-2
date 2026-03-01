-- Migration 030: explicit OSCAR OAuth request token claim metadata (ASVS V10.3.4)

ALTER TABLE IF EXISTS emr_oauth_requests
  ADD COLUMN IF NOT EXISTS token_iss VARCHAR(255),
  ADD COLUMN IF NOT EXISTS token_aud VARCHAR(255),
  ADD COLUMN IF NOT EXISTS token_type VARCHAR(64),
  ADD COLUMN IF NOT EXISTS token_context VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_emr_oauth_requests_claims_lookup
  ON emr_oauth_requests(
    request_token,
    token_iss,
    token_aud,
    token_type,
    token_context,
    expires_at
  );
