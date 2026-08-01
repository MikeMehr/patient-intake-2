-- Optional free-text note describing what the clinic is asking the patient to
-- upload (e.g. "photo of the eyelid swelling"). Shown in the request email and
-- on the token-protected upload page.

ALTER TABLE patient_document_requests
  ADD COLUMN IF NOT EXISTS request_note TEXT;
