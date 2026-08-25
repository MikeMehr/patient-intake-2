-- Short-lived sessions that let a physician's phone send a single photo to
-- their open transcription page (QR-code camera bridge for Ask AI attachments).
-- The photo bytes live inline: they are small (phone re-encodes to JPEG),
-- short-lived (rows expire after minutes), and deleted as soon as the desktop
-- claims them, so blob storage would be overkill.

CREATE TABLE IF NOT EXISTS phone_capture_sessions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT        NOT NULL UNIQUE,
  created_by  UUID        NOT NULL,
  photo       BYTEA,
  photo_mime  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phone_capture_sessions_expires
  ON phone_capture_sessions (expires_at);
