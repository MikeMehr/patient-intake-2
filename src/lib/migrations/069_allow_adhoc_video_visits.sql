-- Migration 069: allow a video visit that belongs to no appointment at all.
--
-- Migration 067 required every visit to carry either an appointment_id or an oscar_appointment_no,
-- because at the time every visit came from one of two places: an online booking, or the OSCAR
-- day-sheet button. That constraint did real work — it stopped orphan rows that nothing could
-- ever reach.
--
-- Inviting a patient to a video call directly has neither key. There is no booking and no OSCAR
-- appointment; someone phones the clinic, or a follow-up needs five minutes of face time, and
-- staff want to send a link now. For those the row's own id *is* the key, and it is reachable
-- through the visit list and the join token.
--
-- So the constraint is dropped rather than worked around. The alternative — inventing a synthetic
-- oscar_appointment_no — would have poisoned the one column whose meaning the tenancy checks
-- depend on, and made "is this a real OSCAR appointment?" unanswerable.
--
-- The partial unique indexes from 067 are untouched and still do their job: they only apply to
-- rows that actually have the key in question, so ad-hoc rows (NULL in both) neither collide with
-- each other nor weaken the guarantees for booked visits.
ALTER TABLE video_visits DROP CONSTRAINT IF EXISTS chk_video_visits_has_key;

-- Distinguishes "created directly by staff" from "derived from an appointment", so the visit list
-- can say where a room came from without inferring it from which columns happen to be NULL.
ALTER TABLE video_visits ADD COLUMN IF NOT EXISTS created_adhoc BOOLEAN NOT NULL DEFAULT FALSE;
