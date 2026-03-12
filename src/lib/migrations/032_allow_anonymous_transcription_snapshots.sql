-- Migration 032: Allow anonymous transcription snapshots (no patient required)
-- Physicians can generate SOAP notes without specifying a patient.
-- Anonymous snapshots cannot be finalized/exported and auto-delete after 12 hours.

-- Make patient_id nullable in patient_encounters for anonymous transcription encounters
ALTER TABLE patient_encounters
  ALTER COLUMN patient_id DROP NOT NULL;

-- Make patient_id nullable in soap_note_versions
ALTER TABLE soap_note_versions
  ALTER COLUMN patient_id DROP NOT NULL;

-- Make patient_id nullable in physician_transcription_sessions
ALTER TABLE physician_transcription_sessions
  ALTER COLUMN patient_id DROP NOT NULL;

-- Index for efficient cleanup of anonymous snapshots older than 12 hours
CREATE INDEX IF NOT EXISTS idx_physician_transcription_sessions_anonymous_created
  ON physician_transcription_sessions(created_at)
  WHERE patient_id IS NULL;
