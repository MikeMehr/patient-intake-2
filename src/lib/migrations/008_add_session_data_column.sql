-- Migration 008: Add session_data JSONB column to physician_sessions
-- This allows storing complete session data as JSON for better flexibility

ALTER TABLE physician_sessions
    ADD COLUMN IF NOT EXISTS session_data JSONB;

-- Create index on session_data for faster queries if needed
CREATE INDEX IF NOT EXISTS idx_physician_sessions_session_data 
    ON physician_sessions USING GIN (session_data);

