-- Migration 044: Add English content column to interview_live_turns
-- Stores the English version of AI questions and patient message translations
-- for the physician monitor (regardless of patient's chosen language).

ALTER TABLE interview_live_turns
  ADD COLUMN IF NOT EXISTS content_en TEXT;
