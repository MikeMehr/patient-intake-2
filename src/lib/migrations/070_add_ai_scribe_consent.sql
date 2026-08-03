-- The patient's answer to the AI-scribe question asked during online booking.
-- NULL = question never asked (pre-feature rows / paths that don't ask).
-- TRUE/FALSE = the patient's explicit answer; FALSE is a valid, bookable answer.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS ai_scribe_consent BOOLEAN;
