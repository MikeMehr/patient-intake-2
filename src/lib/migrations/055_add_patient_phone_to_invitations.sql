-- Patient phone number for SMS-based 2FA on guided-interview invitations.
-- The verification OTP is delivered by SMS (Twilio) instead of email.
ALTER TABLE patient_invitations
  ADD COLUMN IF NOT EXISTS patient_phone VARCHAR(50);
