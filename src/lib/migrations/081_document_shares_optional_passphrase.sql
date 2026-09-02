-- Outbound file shares may now be sent without a passphrase (link-only).
-- A NULL passphrase_hash means the unguessable link token alone opens the share.
-- DROP NOT NULL is a no-op when the column is already nullable, so this stays
-- safe to re-run on every startup.

ALTER TABLE document_shares ALTER COLUMN passphrase_hash DROP NOT NULL;
