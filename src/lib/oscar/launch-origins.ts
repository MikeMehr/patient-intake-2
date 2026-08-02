/**
 * Allow-list of origins that may launch the transcription popup and receive a
 * finished SOAP note back via postMessage.
 *
 * This is the PHI-egress security boundary for the OSCAR eChart integration.
 * The note text is posted to `window.opener` with an explicit targetOrigin;
 * that origin comes from here and never from the URL the browser was opened
 * with, so a page that merely *claims* to be OSCAR cannot receive PHI.
 *
 * Configured via OSCAR_LAUNCH_ALLOWED_ORIGINS (comma-separated). Deliberately
 * NOT a NEXT_PUBLIC_ variable: the browser learns the pinned origin only from
 * the resolve API response, keeping the server authoritative.
 *
 *   OSCAR_LAUNCH_ALLOWED_ORIGINS="https://oscar.mymdonline.ca"
 */

function parseOrigin(value: string, allowInsecure: boolean): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:")) {
    return null;
  }
  // url.origin normalises away trailing slashes, paths, default ports and
  // hostname case, so downstream comparison can be exact string equality.
  return url.origin;
}

/**
 * Parsed contents of OSCAR_LAUNCH_ALLOWED_ORIGINS.
 *
 * Read from the environment on every call rather than cached at module load:
 * the value is tiny, and route handlers in this codebase are tested by mutating
 * process.env between cases.
 */
export function getAllowedLaunchOrigins(): string[] {
  const raw = process.env.OSCAR_LAUNCH_ALLOWED_ORIGINS ?? "";
  // http:// is permitted outside production so the flow can be exercised
  // locally against a fake OSCAR page on a second .test domain.
  const allowInsecure = process.env.NODE_ENV !== "production";
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const origin = parseOrigin(entry, allowInsecure);
    if (origin) seen.add(origin);
  }
  return [...seen];
}

/**
 * Resolve which origin (if any) the popup is allowed to post the note back to.
 *
 * - When the caller supplies an origin, it is returned only if it is an exact
 *   match for a configured entry. Exact equality is essential: a suffix check
 *   would accept https://oscar.mymdonline.ca.evil.com.
 * - When no origin is supplied (or it is unusable) and exactly one origin is
 *   configured, that one is returned. This is the single-clinic deployment we
 *   have today, where there is no ambiguity about who the opener is.
 * - Otherwise null, and the caller must refuse to send.
 */
export function resolveAllowedOpenerOrigin(requested?: string | null): string | null {
  const allowed = getAllowedLaunchOrigins();
  if (allowed.length === 0) return null;

  if (typeof requested === "string" && requested.trim()) {
    const normalized = parseOrigin(requested, process.env.NODE_ENV !== "production");
    if (!normalized) return null;
    return allowed.includes(normalized) ? normalized : null;
  }

  return allowed.length === 1 ? allowed[0]! : null;
}
