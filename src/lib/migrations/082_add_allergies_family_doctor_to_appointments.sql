-- Migration 082: Patient-reported allergies and current family doctor, collected
-- on the online-booking new-patient path. Optional free text. Not sent to OSCAR
-- (its demographics endpoint has no allergy field and appointment.notes is a
-- write-once varchar(255) already carrying the modality/scribe string); shown on
-- the org appointments page so staff can copy them into the new chart.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS allergies TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS family_doctor TEXT;
