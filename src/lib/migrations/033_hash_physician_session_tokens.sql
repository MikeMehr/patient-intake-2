-- Migration 033: Hash physician session tokens
--
-- Previously, physician_sessions.token stored the raw 256-bit token directly.
-- This meant a database breach would expose all active session tokens, allowing
-- an attacker to immediately impersonate any logged-in user.
--
-- The code now stores only an HMAC-SHA256 hash of the raw token (matching the
-- pattern already used for invitation tokens, OTP challenges, and invitation sessions).
-- The raw token lives exclusively in the browser cookie; the DB stores only the hash.
--
-- Because the hash function depends on SESSION_SECRET (which the attacker would not
-- have from a DB-only breach), compromising the DB no longer yields usable tokens.
--
-- Action: delete all existing sessions.
-- Users will be asked to re-login once after this migration deploys.
-- This is the safest approach — trying to rehash in SQL is impossible without
-- the SESSION_SECRET value, and unhashed rows would never match new lookups.

DELETE FROM physician_sessions;
