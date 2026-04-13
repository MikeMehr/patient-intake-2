-- Migration 043: Add live monitor support for physician dashboard
-- Creates interview_live_turns table and adds monitor_guidance to patient_invitations

-- Table to store per-turn live data for physician monitor window
CREATE TABLE IF NOT EXISTS interview_live_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES patient_invitations(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('assistant', 'patient')),
  content TEXT NOT NULL,
  rationale TEXT,
  state_snapshot JSONB,
  is_summary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invitation_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_live_turns_invitation_id
  ON interview_live_turns(invitation_id, turn_index);

-- One-shot guidance sent by physician from monitor window.
-- Cleared by interview route after delivery on the next turn.
ALTER TABLE patient_invitations
  ADD COLUMN IF NOT EXISTS monitor_guidance TEXT;
