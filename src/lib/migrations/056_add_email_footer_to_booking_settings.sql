-- Migration 056: Add email_footer to booking_settings
-- Free-text content (clinic signature / confidentiality notice) appended to the
-- bottom of patient-facing booking emails (confirmation + cancellation).

ALTER TABLE booking_settings ADD COLUMN IF NOT EXISTS email_footer TEXT;
