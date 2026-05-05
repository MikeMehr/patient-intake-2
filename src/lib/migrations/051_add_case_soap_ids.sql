-- Migration 051: Add case_soap_ids to physician_transcription_sessions
-- Stores an ordered JSON array of all soap_version_ids generated in the same batch.
-- Only the first case gets a session pointer row; sibling IDs are stored here.
ALTER TABLE physician_transcription_sessions
  ADD COLUMN IF NOT EXISTS case_soap_ids JSONB;
