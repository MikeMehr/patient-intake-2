"use client";

/**
 * The second step of a workforce sign-in, once /api/auth/login has answered with a challenge.
 *
 * This exists as a component because the flow being copy-pasted per login page is precisely
 * how it went wrong: /auth/login implemented it, /org/login and /admin/login did not, and
 * both tested only `if (!response.ok)` — but the challenge is a 202, which IS ok. Those pages
 * fell through to a redirect with no session cookie and bounced straight back to the login
 * screen, an unescapable loop for anyone with MFA enabled. One copy, one place to change.
 *
 * The parent owns username/password and the post-login redirect; this owns everything from
 * the challenge token onward and hands back the userType so the parent can route.
 */

import { useState } from "react";

interface Props {
  /** Returned by /api/auth/login with the 202. */
  challengeToken: string;
  /** The server's "we sent you a code" text, shown above the form. */
  message?: string | null;
  /** Called with data.userType once a session cookie has been minted. */
  onVerified: (userType: string) => void;
}

export default function MfaChallengeForm({ challengeToken, message, onVerified }: Props) {
  const [otpCode, setOtpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70";
  const submitClass =
    "w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400";
  const linkClass = "w-full text-sm text-slate-600 underline hover:text-slate-900";

  /** Both recovery paths mint the same session cookie; only the endpoint and body differ. */
  const submitTo = async (path: string, body: Record<string, unknown>, fallback: string) => {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || fallback);
        setLoading(false);
        return;
      }
      onVerified(data.userType);
    } catch {
      setError("An error occurred. Please try again.");
      setLoading(false);
    }
  };

  const handleOtp = (e: React.FormEvent) => {
    e.preventDefault();
    submitTo(
      "/api/auth/login/mfa/verify",
      { challengeToken, otpCode, trustDevice },
      "Verification failed",
    );
  };

  const handleBackupCode = (e: React.FormEvent) => {
    e.preventDefault();
    submitTo(
      "/api/auth/login/mfa/recovery",
      { challengeToken, backupCode },
      "Backup code verification failed",
    );
  };

  return (
    <>
      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
          <p className="text-sm text-blue-800">{message}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {useBackupCode ? (
        <form onSubmit={handleBackupCode} className="space-y-4">
          <div>
            <label htmlFor="backupCode" className="block text-sm font-medium text-slate-700 mb-1">
              Backup code
            </label>
            <input
              id="backupCode"
              type="text"
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value)}
              required
              autoFocus
              autoComplete="one-time-code"
              disabled={loading}
              className={inputClass}
              placeholder="Enter a backup code"
            />
          </div>

          <button type="submit" disabled={loading} className={submitClass}>
            {loading ? "Verifying..." : "Verify backup code"}
          </button>

          <button
            type="button"
            onClick={() => {
              setUseBackupCode(false);
              setError(null);
            }}
            disabled={loading}
            className={linkClass}
          >
            Use the emailed code instead
          </button>
        </form>
      ) : (
        <form onSubmit={handleOtp} className="space-y-4">
          <div>
            <label htmlFor="otpCode" className="block text-sm font-medium text-slate-700 mb-1">
              Verification code
            </label>
            <input
              id="otpCode"
              type="text"
              inputMode="numeric"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              required
              autoFocus
              autoComplete="one-time-code"
              disabled={loading}
              className={inputClass}
              placeholder="6-digit code"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
            Trust this browser and skip codes next time
          </label>

          <button type="submit" disabled={loading} className={submitClass}>
            {loading ? "Verifying..." : "Verify and sign in"}
          </button>

          <button
            type="button"
            onClick={() => {
              setUseBackupCode(true);
              setError(null);
            }}
            disabled={loading}
            className={linkClass}
          >
            Use a backup code instead
          </button>
        </form>
      )}
    </>
  );
}
