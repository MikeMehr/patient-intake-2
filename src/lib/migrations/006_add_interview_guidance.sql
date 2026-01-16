-- Migration 006: Add interview_guidance to physicians table
-- Allows each physician to customize how the AI conducts patient interviews

ALTER TABLE physicians 
    ADD COLUMN IF NOT EXISTS interview_guidance TEXT;

CREATE INDEX IF NOT EXISTS idx_physicians_interview_guidance 
    ON physicians(interview_guidance) 
    WHERE interview_guidance IS NOT NULL;

