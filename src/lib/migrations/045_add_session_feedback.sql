-- Migration 045: Add patient feedback (star rating + comments) to patient_sessions
-- Patients can rate their Health Assist AI experience on the completion page.

ALTER TABLE patient_sessions
  ADD COLUMN IF NOT EXISTS feedback_rating       INTEGER
    CHECK (feedback_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS feedback_comments     TEXT,
  ADD COLUMN IF NOT EXISTS feedback_submitted_at TIMESTAMP WITH TIME ZONE;
