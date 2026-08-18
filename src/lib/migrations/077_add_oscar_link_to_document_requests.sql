-- Lets a "Request Documents" upload be filed into the same patient's OSCAR chart
-- via the eChart "Chart Attachment" popup, the same way appointment_files (073)
-- already works. oscar_demographic_no is populated when the request was started
-- from the eChart's "Request Docs" button (which already passes demographicNo —
-- see src/app/org/(protected)/documents/page.tsx); it stays NULL for requests
-- created without that context, and those files simply aren't offered for import.

ALTER TABLE patient_document_requests ADD COLUMN IF NOT EXISTS oscar_demographic_no TEXT;

CREATE INDEX IF NOT EXISTS idx_patient_document_requests_oscar_demographic_no
  ON patient_document_requests (oscar_demographic_no)
  WHERE oscar_demographic_no IS NOT NULL;

-- Set once a physician has pulled this file into the OSCAR chart, mirroring
-- appointment_files.imported_to_oscar_at.
ALTER TABLE patient_document_files ADD COLUMN IF NOT EXISTS imported_to_oscar_at TIMESTAMPTZ;
