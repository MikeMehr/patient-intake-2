-- Migration 028: explicit token claim metadata (ASVS V10.1.1)

ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS token_iss VARCHAR(255),
  ADD COLUMN IF NOT EXISTS token_aud VARCHAR(255),
  ADD COLUMN IF NOT EXISTS token_type VARCHAR(64),
  ADD COLUMN IF NOT EXISTS token_context VARCHAR(128);

ALTER TABLE auth_mfa_challenges
  ADD COLUMN IF NOT EXISTS token_iss VARCHAR(255),
  ADD COLUMN IF NOT EXISTS token_aud VARCHAR(255),
  ADD COLUMN IF NOT EXISTS token_type VARCHAR(64),
  ADD COLUMN IF NOT EXISTS token_context VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_claims
  ON password_reset_tokens(token_iss, token_aud, token_type, token_context)
  WHERE used = FALSE;

CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_claims
  ON auth_mfa_challenges(token_iss, token_aud, token_type, token_context, purpose, consumed_at);
