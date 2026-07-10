-- Migration 058: Support self-serve interview invitations on patient_invitations
-- is_self_serve marks invitations created by the public /interview/[clinicSlug] flow
-- (no provider session). pending_oscar_demographics holds a new patient's full
-- demographics (health card encrypted) so the OSCAR chart can be created only once
-- the patient actually completes/ends the interview.

ALTER TABLE patient_invitations
  ADD COLUMN IF NOT EXISTS is_self_serve BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE patient_invitations
  ADD COLUMN IF NOT EXISTS pending_oscar_demographics JSONB;
