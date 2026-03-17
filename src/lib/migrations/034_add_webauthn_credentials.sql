-- Migration 034: WebAuthn credential storage for passkey authentication

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[],
  device_name TEXT NOT NULL DEFAULT 'My passkey',
  user_type VARCHAR(32) NOT NULL CHECK (user_type IN ('provider', 'org_admin', 'super_admin')),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user
  ON webauthn_credentials(user_type, user_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge TEXT NOT NULL,
  user_type VARCHAR(32) CHECK (user_type IN ('provider', 'org_admin', 'super_admin')),
  user_id UUID,
  purpose VARCHAR(16) NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_lookup
  ON webauthn_challenges(challenge, purpose);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_cleanup
  ON webauthn_challenges(expires_at) WHERE consumed_at IS NULL;
