-- Migration 065: Add appointment_modality to booking_settings
-- How the clinic's booked appointments happen: PHONE | VIDEO | IN_PERSON.
-- Shown to patients throughout the booking flow and in confirmation emails.
-- Defaults to PHONE — every clinic currently using online booking is telehealth.

ALTER TABLE booking_settings
  ADD COLUMN IF NOT EXISTS appointment_modality TEXT NOT NULL DEFAULT 'PHONE';
