/**
 * Shared rules for files a patient uploads to us — the emailed document-request
 * link and the booking attachment both go through here so "what a patient may
 * upload" has exactly one definition.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB each

const ALLOWED_PREFIXES = ["image/"];
const ALLOWED_EXACT = ["application/pdf"];

export function isAllowedType(type: string): boolean {
  const t = (type || "").toLowerCase();
  return ALLOWED_PREFIXES.some((p) => t.startsWith(p)) || ALLOWED_EXACT.includes(t);
}

export function sanitizeFilename(name: string): string {
  return (name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120);
}

/** Human-readable rejection reason, or null when the file is acceptable. */
export function validatePatientUpload(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) {
    return `"${file.name}" is larger than the 10 MB limit.`;
  }
  if (!isAllowedType(file.type)) {
    return `"${file.name}" is not an image or PDF.`;
  }
  return null;
}
