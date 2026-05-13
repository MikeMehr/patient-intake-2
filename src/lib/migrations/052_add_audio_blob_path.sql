-- Migration 052: Add audio_blob_path to soap_note_versions
-- Stores the Azure Blob path of the saved WAV recording to allow re-transcription
-- with a corrected language. Cleared at finalization time along with draft_transcript.
ALTER TABLE soap_note_versions
  ADD COLUMN IF NOT EXISTS audio_blob_path TEXT;
