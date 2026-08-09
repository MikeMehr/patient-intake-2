/**
 * Validation for the `returnTo` deep-link parameter set by the middleware when
 * an unauthenticated request hits a protected page (see `src/proxy.ts`).
 *
 * This exists because a `returnTo` value is attacker-controllable — anyone can
 * hand a physician a link to `/auth/login?returnTo=…`. After a successful login
 * we navigate to that value, so an unvalidated string is an open redirect
 * straight out of an authenticated clinical session.
 *
 * Kept in its own module (no DOM, no React) so it can be unit-tested directly.
 */

/** Absolute cap, matching the cap the middleware applies when it sets the value. */
const MAX_LENGTH = 512;

/** Only these prefixes are ever safe to bounce back to after login. */
const ALLOWED_PREFIXES = ["/physician/", "/launch/", "/org/"];

/** Origin used purely as a parsing base; never appears in the returned value. */
const PARSE_BASE = "https://placeholder.invalid";

/**
 * Rejects control characters (C0 and DEL) and backslashes. Neither is ever
 * legitimate in a path we generated, and both are the usual ingredients of
 * parser-differential bypasses — a newline splitting a header, or a backslash
 * that one parser normalises to "/" and another does not.
 *
 * Written as an explicit scan rather than a regex character class: the class
 * needs literal control-character escapes, which are easy to get subtly wrong
 * (an escaped range that also swallows "-" would reject every hyphenated path).
 */
function hasUnsafeChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
    if (code === 0x5c) return true; // backslash
  }
  return false;
}

/**
 * Decode a `returnTo` value that may have been percent-encoded once or twice.
 *
 * The middleware previously wrapped the value in `encodeURIComponent` before
 * handing it to `URLSearchParams.set` (which encodes again), producing
 * double-encoded values like `%252Fphysician%252F…`. That is fixed at the
 * source, but links already in flight — a login page open in a tab during a
 * deploy — can still carry the old form, so decode a second time when the
 * first pass leaves something that still looks encoded.
 */
function decodeOnceOrTwice(raw: string): string {
  let value = raw;
  for (let i = 0; i < 2; i++) {
    // Stop as soon as the value is a plain path. This is the important guard:
    // a correctly-encoded returnTo often still contains percent escapes inside
    // its query string (e.g. ?origin=https%3A%2F%2Foscar.mymdonline.ca), and
    // decoding again would corrupt it — turning ?q=a%26b into two parameters.
    if (value.startsWith("/")) break;
    if (!value.includes("%")) break;
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      break; // malformed escape sequence — keep what we have; validation below rejects it
    }
    if (decoded === value) break;
    value = decoded;
  }
  return value;
}

/**
 * Returns a safe same-origin path (`pathname + search`) to navigate to after
 * login, or `null` if the input is missing, malformed, or points anywhere we
 * are not willing to send an authenticated user.
 */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  const value = decodeOnceOrTwice(raw.trim());
  if (!value || value.length > MAX_LENGTH) return null;

  // Must be a plain absolute path. Rejects absolute URLs ("https://evil.com"),
  // scheme-relative URLs ("//evil.com"), and anything carrying a scheme at all
  // ("javascript:…").
  if (!value.startsWith("/")) return null;

  // Protocol-relative in both spellings. Browsers normalise a leading
  // backslash to a forward slash, so "/\evil.com" behaves like "//evil.com".
  if (value.startsWith("//")) return null;

  if (hasUnsafeChars(value)) return null;

  let url: URL;
  try {
    url = new URL(value, PARSE_BASE);
  } catch {
    return null;
  }

  // Belt and braces: if any check above missed a form the URL parser reads as
  // absolute, the origin will have moved off the placeholder.
  if (url.origin !== PARSE_BASE) return null;

  if (!ALLOWED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;

  // Return the reconstructed value, never the raw input. Drops any fragment.
  return url.pathname + url.search;
}

/**
 * True when a `returnTo` is nothing more than the dashboard itself — no query
 * string, no deeper path.
 *
 * The middleware stamps a `returnTo` on *every* unauthenticated hit to a
 * `/physician` page, which includes the ordinary cases of opening a bookmark or
 * coming back after a session expired. Those carry no deep-link payload, so
 * they are indistinguishable from a plain sign-in and must not suppress the
 * physician's "land on transcription" preference. Anything else — a different
 * page, or a dashboard URL carrying params such as an OSCAR launch — keeps its
 * own destination.
 */
export function isBareDashboardReturnTo(value: string | null | undefined): boolean {
  return value === "/physician/dashboard" || value === "/physician/dashboard/";
}

/** Convenience wrapper for the browser: read and validate in one step. */
export function readReturnToFromLocation(search: string): string | null {
  try {
    return sanitizeReturnTo(new URLSearchParams(search).get("returnTo"));
  } catch {
    return null;
  }
}
