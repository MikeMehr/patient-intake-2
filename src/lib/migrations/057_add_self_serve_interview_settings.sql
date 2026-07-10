-- Migration 057: Add self-serve AI Guided Interview settings to booking_settings
-- Lets a clinic expose the guided interview directly to patients (no physician invite).
-- The interview attaches to one designated default physician per clinic.

ALTER TABLE booking_settings
  ADD COLUMN IF NOT EXISTS self_serve_interview_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE booking_settings
  ADD COLUMN IF NOT EXISTS self_serve_interview_physician_id UUID
    REFERENCES physicians(id) ON DELETE SET NULL;
