-- Migration 026: backup recovery codes for workforce MFA

CREATE TABLE IF NOT EXISTS auth_mfa_backup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_type VARCHAR(32) NOT NULL CHECK (user_type IN ('provider', 'org_admin', 'super_admin')),
  user_id UUID NOT NULL,
  code_hash VARCHAR(128) NOT NULL,
  used_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_backup_codes_user
  ON auth_mfa_backup_codes(user_type, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_backup_codes_active
  ON auth_mfa_backup_codes(user_type, user_id, used_at, invalidated_at);
