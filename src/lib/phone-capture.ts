import { createHash, randomBytes } from "crypto";

/** How long a QR capture code stays scannable/usable. */
export const PHONE_CAPTURE_TTL_MINUTES = 10;

/** Raw image cap — matches the Ask AI image limit (Azure OpenAI vision cap is 20 MB). */
export const PHONE_CAPTURE_MAX_BYTES = 20 * 1024 * 1024;

export const PHONE_CAPTURE_ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/**
 * Generate the token embedded in the QR-code URL. Only the SHA-256 hash is
 * persisted, so a DB leak can't reconstruct live capture links.
 */
export function generatePhoneCaptureToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString("hex");
  return {
    raw,
    hash: hashPhoneCaptureToken(raw),
    expiresAt: new Date(Date.now() + PHONE_CAPTURE_TTL_MINUTES * 60 * 1000),
  };
}

/** Hash a raw capture token for DB lookup. */
export function hashPhoneCaptureToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Raw tokens are 32 random bytes hex-encoded; reject anything else before hitting the DB. */
export function isValidPhoneCaptureTokenFormat(raw: string): boolean {
  return /^[0-9a-f]{64}$/.test(raw);
}
