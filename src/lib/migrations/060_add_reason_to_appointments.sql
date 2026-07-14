-- Migration 060: Patient-entered reason for visit on online bookings.
-- Written to OSCAR's appointment.reason (varchar(80)) so it shows on the
-- provider's day sheet instead of the old hardcoded "Online booking".
-- Stored untruncated here; the OSCAR write caps to that column's width.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reason TEXT;
