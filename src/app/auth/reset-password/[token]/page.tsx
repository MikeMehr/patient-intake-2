// Set a new password using a reset token
"use client";

import { FormEvent, useState } from "react";
import { useParams } from "next/navigation";

export default function ResetPasswordTokenPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token || "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaVerified, setMfaVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const requestMfaChallenge = async (): Promise<{ mfaRequired: boolean; challengeToken?: string }> => {
    const res = await fetch(`/api/auth/reset-password/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "request_mfa" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Failed to request verification code");
    }
    if (data?.mfaRequired && data?.challengeToken) {
      setMfaRequired(true);
      setChallengeToken(data.challengeToken);
      setMessage("Enter the verification code sent to your email before resetting your password.");
      return { mfaRequired: true, challengeToken: data.challengeToken };
    } else {
      setMfaRequired(false);
      setMfaVerified(true);
      return { mfaRequired: false };
    }
  };

  const handleVerifyCode = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      let challengeToUse = challengeToken;
      if (!challengeToken) {
        const mfa = await requestMfaChallenge();
        challengeToUse = mfa.challengeToken || "";
      }
      const res = await fetch(`/api/auth/reset-password/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify_mfa",
          challengeToken: challengeToUse,
          otpCode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to verify code");
      }
      setMfaVerified(true);
      setMessage("Verification complete. You can now set your new password.");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage("");
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      let challengeToUse = challengeToken;
      if (!challengeToken && !mfaVerified) {
        const mfa = await requestMfaChallenge();
        challengeToUse = mfa.challengeToken || "";
        if (mfa.mfaRequired) {
          throw new Error("Verify the code before updating your password");
        }
      }
      if ((mfaRequired || challengeToUse) && !mfaVerified) {
        throw new Error("Verify the code before updating your password");
      }
      const res = await fetch(`/api/auth/reset-password/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword, challengeToken: challengeToUse }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to reset password");
      }

      setMessage(data?.message || "Password has been reset. You can sign in.");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-semibold text-slate-900">
          Set a new password
        </h1>
        {!mfaVerified && (
          <p className="mt-2 text-sm text-slate-600">
            We may require a verification code to complete password reset.
          </p>
        )}

        {!mfaVerified && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            {!mfaRequired ? (
              <button
                type="button"
                onClick={async () => {
                  setLoading(true);
                  setError("");
                  setMessage("");
                  try {
                    await requestMfaChallenge();
                  } catch (err: any) {
                    setError(err.message || "Failed to send code");
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? "Checking..." : "Send verification code"}
              </button>
            ) : (
              <form className="space-y-3" onSubmit={handleVerifyCode}>
                <label
                  className="mb-1 block text-sm font-medium text-slate-700"
                  htmlFor="otp-code"
                >
                  Verification code
                </label>
                <input
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  disabled={loading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder="Enter 6-digit code"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {loading ? "Verifying..." : "Verify code"}
                </button>
              </form>
            )}
          </div>
        )}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-slate-700"
              htmlFor="new-password"
            >
              New password
            </label>
            <input
              id="new-password"
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={loading}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              placeholder="Enter a new password"
            />
          </div>

          <div>
            <label
              className="mb-1 block text-sm font-medium text-slate-700"
              htmlFor="confirm-password"
            >
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              placeholder="Re-enter your new password"
            />
          </div>

          <button
            type="submit"
            disabled={loading || (mfaRequired && !mfaVerified)}
            className="w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {loading ? "Updating..." : "Update password"}
          </button>
        </form>

        {message && <p className="mt-4 text-sm text-emerald-600">{message}</p>}
        {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
      </div>
    </div>
  );
}



