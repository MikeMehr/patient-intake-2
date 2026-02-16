-- Migration 016: Invitation security primitives (tokenized invites, OTP, sessions, audit, rate limits)

ALTER TABLE patient_invitations
  ADD COLUMN IF NOT EXISTS token_hash VARCHAR(128),
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS patient_background TEXT,
  ADD COLUMN IF NOT EXISTS interview_guidance TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_invitations_token_hash
  ON patient_invitations(token_hash)
  WHERE token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_invitations_token_expires_at
  ON patient_invitations(token_expires_at)
  WHERE token_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_invitations_used_at
  ON patient_invitations(used_at)
  WHERE used_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_invitations_revoked_at
  ON patient_invitations(revoked_at)
  WHERE revoked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_invitations_expires_at
  ON patient_invitations(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS invitation_otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES patient_invitations(id) ON DELETE CASCADE,
  otp_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified_at TIMESTAMP WITH TIME ZONE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  cooldown_until TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invitation_otp_challenges_invitation_id
  ON invitation_otp_challenges(invitation_id);

CREATE INDEX IF NOT EXISTS idx_invitation_otp_challenges_expires_at
  ON invitation_otp_challenges(expires_at);

CREATE TABLE IF NOT EXISTS invitation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES patient_invitations(id) ON DELETE CASCADE,
  session_token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ip_address VARCHAR(80),
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invitation_sessions_invitation_id
  ON invitation_sessions(invitation_id);

CREATE INDEX IF NOT EXISTS idx_invitation_sessions_expires_at
  ON invitation_sessions(expires_at);

CREATE TABLE IF NOT EXISTS invitation_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID REFERENCES patient_invitations(id) ON DELETE SET NULL,
  event_type VARCHAR(64) NOT NULL,
  ip_address VARCHAR(80),
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invitation_audit_invitation_id
  ON invitation_audit_log(invitation_id);

CREATE INDEX IF NOT EXISTS idx_invitation_audit_event_type
  ON invitation_audit_log(event_type);

CREATE INDEX IF NOT EXISTS idx_invitation_audit_created_at
  ON invitation_audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS invitation_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key VARCHAR(255) NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitation_rate_limits_bucket_key
  ON invitation_rate_limits(bucket_key);

CREATE INDEX IF NOT EXISTS idx_invitation_rate_limits_expires_at
  ON invitation_rate_limits(expires_at);
