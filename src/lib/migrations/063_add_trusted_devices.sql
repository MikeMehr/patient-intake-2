-- Migration 063: trusted devices ("remember this device") for workforce 2FA.
-- After a successful SMS/email 2FA, a browser can be marked trusted so that
-- subsequent logins on that device skip the second factor until it expires.
-- The raw token lives only in the browser cookie; we store only its HMAC hash.
CREATE TABLE IF NOT EXISTS auth_trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_type VARCHAR(32) NOT NULL CHECK (user_type IN ('provider', 'org_admin', 'super_admin')),
  user_id UUID NOT NULL,
  device_token_hash VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_trusted_devices_user
  ON auth_trusted_devices(user_type, user_id);
