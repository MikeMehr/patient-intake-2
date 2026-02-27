-- Migration 027: recovery versioning + admin reset state for all workforce accounts

ALTER TABLE physicians
  ADD COLUMN IF NOT EXISTS mfa_recovery_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS mfa_recovery_reset_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backup_codes_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE organization_users
  ADD COLUMN IF NOT EXISTS mfa_recovery_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS mfa_recovery_reset_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backup_codes_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE super_admin_users
  ADD COLUMN IF NOT EXISTS mfa_recovery_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS mfa_recovery_reset_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backup_codes_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE auth_mfa_backup_codes
  ADD COLUMN IF NOT EXISTS recovery_version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_auth_mfa_backup_codes_recovery_version
  ON auth_mfa_backup_codes(user_type, user_id, recovery_version, used_at, invalidated_at);
