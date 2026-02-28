-- Migration 029: explicit invitation session token claim metadata (ASVS V10.3.1)

ALTER TABLE invitation_sessions
  ADD COLUMN IF NOT EXISTS token_iss VARCHAR(255),
  ADD COLUMN IF NOT EXISTS token_aud VARCHAR(255),
  ADD COLUMN IF NOT EXISTS token_type VARCHAR(64),
  ADD COLUMN IF NOT EXISTS token_context VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_invitation_sessions_claims
  ON invitation_sessions(token_iss, token_aud, token_type, token_context, invitation_id, expires_at);
