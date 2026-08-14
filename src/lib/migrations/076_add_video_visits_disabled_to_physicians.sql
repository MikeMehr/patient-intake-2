-- Migration 076: an explicit "this provider does not do video visits" switch.
--
-- Until now a provider's ability to hold a video visit was inferred from one thing: whether
-- doxy_room_url was set. That inference is correct but silent, and silence is what caused the
-- incident it guards against — a provider with no room took a video booking, the confirmation
-- email promised a waiting-room link, and no link existed.
--
-- The absence of a room is a fact about setup, not a decision. Someone pasting a URL onto the
-- wrong provider (easy: two providers here share a surname) would quietly re-enable video for a
-- provider who does not do them. This column records the decision itself, so the two cannot be
-- confused: no room means *cannot*, this flag means *will not*.
--
-- DEFAULT FALSE so every existing provider keeps exactly the behaviour they have today; the flag
-- only ever removes an option, never grants one. A provider with the flag set and a room present
-- is still phone-only — see physicianSupportsVideo() in src/lib/booking-store.ts, which requires
-- a room AND the absence of this flag.
ALTER TABLE physicians
  ADD COLUMN IF NOT EXISTS video_visits_disabled BOOLEAN NOT NULL DEFAULT FALSE;
