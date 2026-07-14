/**
 * Client-safe classification of auth failures from /api/physician/* responses.
 * No server imports — safe to use in "use client" components.
 */

export type AuthFailure =
  /** No usable session at all: the user must sign in again. */
  | "unauthenticated"
  /**
   * Signed in, but as an account that isn't a provider — every provider-only
   * route answers `403 Provider access required.` This happens when the shared
   * session cookie was replaced by a Booking-admin session (see
   * src/app/physician/layout.tsx). Recoverable by switching account; it does
   * not require a full re-login.
   */
  | "wrong_account";

export function classifyAuthFailure(res: Response): AuthFailure | null {
  if (res.status === 401) return "unauthenticated";
  if (res.status === 403) return "wrong_account";
  return null;
}
