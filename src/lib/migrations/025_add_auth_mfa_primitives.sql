-- Migration 025: auth MFA primitives for login + password reset

-- MFA flags for all workforce user tables.
ALTER TABLE physicians
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE organization_users
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE super_admin_users
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Generic OTP challenge storage for workforce auth flows.
-- We intentionally avoid table-specific foreign keys because user_id can belong
-- to different user tables (provider/org_admin/super_admin).
CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_type VARCHAR(32) NOT NULL CHECK (user_type IN ('provider', 'org_admin', 'super_admin')),
  user_id UUID NOT NULL,
  purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('login', 'password_reset')),
  challenge_token_hash VARCHAR(128) NOT NULL UNIQUE,
  otp_hash VARCHAR(128) NOT NULL,
  context_token_hash VARCHAR(128),
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  cooldown_until TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_lookup
  ON auth_mfa_challenges(challenge_token_hash, purpose, consumed_at);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_user
  ON auth_mfa_challenges(user_type, user_id, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_cleanup
  ON auth_mfa_challenges(expires_at, consumed_at);
