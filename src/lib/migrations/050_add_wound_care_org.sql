-- Migration 050: Add wound_care feature flag to organizations
-- When enabled, providers in that org see wound care tools on the transcription page.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS wound_care BOOLEAN NOT NULL DEFAULT FALSE;
