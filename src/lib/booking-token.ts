import { createHash, randomBytes } from "crypto";

const MANAGE_TOKEN_TTL_DAYS = 30;

/**
 * Generate a cryptographically random manage token for appointment self-service.
 * Returns both the raw token (for the email link) and its SHA-256 hash (for storage).
 */
export function generateManageToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString("hex");
  const hash = hashManageToken(raw);
  const expiresAt = new Date(Date.now() + MANAGE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { raw, hash, expiresAt };
}

/** Hash a raw manage token for DB lookup. */
export function hashManageToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
