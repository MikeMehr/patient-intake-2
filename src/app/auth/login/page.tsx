"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLoginSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }

      if (data.mfaRequired && data.challengeToken) {
        setMfaRequired(true);
        setChallengeToken(data.challengeToken);
        setUseBackupCode(false);
        setOtpCode("");
        setBackupCode("");
        setMessage(data.message || "Enter the verification code sent to your email.");
        setLoading(false);
        return;
      }

      // Redirect based on user type
      if (data.userType === "super_admin") {
        router.push("/admin/dashboard");
      } else if (data.userType === "org_admin") {
        router.push("/org/dashboard");
      } else {
        router.push("/physician/dashboard");
      }
      router.refresh();
    } catch (err) {
      setError("An error occurred. Please try again.");
      setLoading(false);
    }
  };

  const handleBackupCodeVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login/mfa/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken,
          backupCode,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Backup code verification failed");
        setLoading(false);
        return;
      }

      if (data.userType === "super_admin") {
        router.push("/admin/dashboard");
      } else if (data.userType === "org_admin") {
        router.push("/org/dashboard");
      } else {
        router.push("/physician/dashboard");
      }
      router.refresh();
    } catch {
      setError("An error occurred. Please try again.");
      setLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken,
          otpCode,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Verification failed");
        setLoading(false);
        return;
      }

      if (data.userType === "super_admin") {
        router.push("/admin/dashboard");
      } else if (data.userType === "org_admin") {
        router.push("/org/dashboard");
      } else {
        router.push("/physician/dashboard");
      }
      router.refresh();
    } catch {
      setError("An error occurred. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">
          Physician Sign In
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          Sign in to access your patient intake dashboard.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {message && (
          <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
            <p className="text-sm text-emerald-800">{message}</p>
          </div>
        )}

        {!mfaRequired ? (
        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={loading}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              placeholder="Enter your username"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        ) : (
          <form onSubmit={useBackupCode ? handleBackupCodeVerify : handleMfaVerify} className="space-y-4">
            <div>
              <label
                htmlFor="otp-code"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                {useBackupCode ? "Backup recovery code" : "Verification code"}
              </label>
              <input
                id="otp-code"
                type="text"
                inputMode={useBackupCode ? "text" : "numeric"}
                pattern={useBackupCode ? undefined : "[0-9]{6}"}
                maxLength={useBackupCode ? 20 : 6}
                value={useBackupCode ? backupCode : otpCode}
                onChange={(e) =>
                  useBackupCode
                    ? setBackupCode(e.target.value.toUpperCase())
                    : setOtpCode(e.target.value.replace(/\D/g, ""))
                }
                required
                disabled={loading}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                placeholder={useBackupCode ? "Enter backup code" : "Enter 6-digit code"}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {loading ? "Verifying..." : useBackupCode ? "Use backup code and sign in" : "Verify and sign in"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleLoginSubmit}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Resend code
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setUseBackupCode((prev) => !prev);
                setError(null);
                setMessage(
                  !useBackupCode
                    ? "Using backup recovery code instead of email OTP."
                    : "Enter the verification code sent to your email.",
                );
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {useBackupCode ? "Use email verification code instead" : "Use backup recovery code instead"}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <a
            href="/auth/reset-password"
            className="text-sm text-slate-600 hover:text-slate-900 underline"
          >
            Forgot your password?
          </a>
        </div>

        <p className="mt-6 text-xs text-slate-500 text-center">
          This application is HIPAA-compliant and requires authentication to protect patient health information.
        </p>
      </div>
    </div>
  );
}

