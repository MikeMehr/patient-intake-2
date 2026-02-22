-- Migration 021: stop storing raw tokenized invitation links

ALTER TABLE patient_invitations
  ALTER COLUMN invitation_link DROP NOT NULL;

ALTER TABLE patient_invitations
  DROP CONSTRAINT IF EXISTS patient_invitations_physician_id_patient_email_invitation_link_key;
