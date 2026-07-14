/**
 * Crash/reload protection for the in-progress transcript.
 *
 * Deliberately sessionStorage, not localStorage. The transcript is PHI, and
 * localStorage would be wrong here on two counts:
 *
 *  - It is shared across tabs. One key means a transcript typed for Patient X
 *    could be offered for restore in a tab open on Patient Y — a wrong-patient
 *    hazard, not merely a privacy one.
 *  - It outlives the browser session with no expiry, leaving PHI at rest on a
 *    shared clinic workstation for whoever sits down next. Clearing it reliably
 *    is not achievable: idle expiry, a 401 redirect, a crash and a tab close are
 *    all exits that never run our cleanup.
 *
 * sessionStorage is per-tab and dies with the tab, which matches the failure
 * this guards (a tab losing its own work) and fails safe otherwise. It also
 * matches existing practice: PHI-adjacent client values in this app use
 * sessionStorage, while localStorage holds only the non-PHI language preference.
 *
 * Durable cross-restart recovery, if ever wanted, belongs server-side alongside
 * the existing soap_versions.draft_transcript column — encrypted at rest and
 * covered by the PHI audit trail.
 */

const KEY_PREFIX = "ha:tx-draft:v1:";

/** Matches the session idle timeout (IDLE_TIMEOUT_MS in src/lib/auth.ts). */
const MAX_AGE_MS = 30 * 60 * 1000;

interface StoredTranscript {
  text: string;
  savedAt: number;
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function saveTranscript(userId: string | undefined, text: string): void {
  if (!userId || typeof window === "undefined") return;
  try {
    if (!text.trim()) {
      window.sessionStorage.removeItem(keyFor(userId));
      return;
    }
    const payload: StoredTranscript = { text, savedAt: Date.now() };
    window.sessionStorage.setItem(keyFor(userId), JSON.stringify(payload));
  } catch {
    // Private mode or quota exhaustion — autosave is a safety net, never a
    // reason to interrupt the physician.
  }
}

export function loadTranscript(
  userId: string | undefined,
): StoredTranscript | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as StoredTranscript).text !== "string" ||
      typeof (parsed as StoredTranscript).savedAt !== "number"
    ) {
      window.sessionStorage.removeItem(keyFor(userId));
      return null;
    }
    const stored = parsed as StoredTranscript;
    if (Date.now() - stored.savedAt > MAX_AGE_MS) {
      window.sessionStorage.removeItem(keyFor(userId));
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

export function clearStoredTranscript(userId: string | undefined): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(keyFor(userId));
  } catch {
    // Ignore.
  }
}
