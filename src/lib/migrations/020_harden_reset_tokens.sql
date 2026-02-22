-- Migration 020: store only password reset token hashes

ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS token_hash VARCHAR(128);

ALTER TABLE password_reset_tokens
  ALTER COLUMN token DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash
  ON password_reset_tokens(token_hash)
  WHERE token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_used
  ON password_reset_tokens(expires_at, used);
