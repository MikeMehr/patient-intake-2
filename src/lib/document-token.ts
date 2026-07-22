import { createHash, randomBytes } from "crypto";

const DOCUMENT_TOKEN_TTL_DAYS = 7;

/**
 * Generate a cryptographically random token for a patient document-upload link.
 * Returns the raw token (embedded in the emailed URL) and its SHA-256 hash
 * (the only form persisted, so a DB leak can't reconstruct live links).
 */
export function generateDocumentToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString("hex");
  const hash = hashDocumentToken(raw);
  const expiresAt = new Date(Date.now() + DOCUMENT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { raw, hash, expiresAt };
}

/** Hash a raw document token for DB lookup. */
export function hashDocumentToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
