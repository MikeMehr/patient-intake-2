-- Files a patient attaches while booking (a photo or PDF of their complaint/form).
-- Bytes live in Azure Blob Storage; only the blob path is stored here, matching
-- patient_document_files (061).

CREATE TABLE IF NOT EXISTS appointment_files (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id       UUID        NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  blob_path            TEXT        NOT NULL,
  original_filename    TEXT,
  content_type         TEXT,
  size_bytes           BIGINT,
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set once a physician has pulled this file into the OSCAR chart, so it isn't
  -- offered for import twice.
  imported_to_oscar_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_appointment_files_appointment
  ON appointment_files (appointment_id);
