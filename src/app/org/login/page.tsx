"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MfaChallengeForm from "@/components/auth/MfaChallengeForm";
import { readReturnToFromLocation } from "@/lib/client/return-to";

export default function OrgAdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set when /api/auth/login answers 202 because the account has mfa_enabled. No session
  // cookie exists until the challenge is completed.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [mfaMessage, setMfaMessage] = useState<string | null>(null);
  // Deep link stamped by the middleware when an unauthenticated request hit an
  // /org page (e.g. /org/documents from the eChart "Request Docs" button).
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    setReturnTo(readReturnToFromLocation(window.location.search));
  }, []);

  const redirectByUserType = (userType: string) => {
    // Honour an /org deep link for anyone who can hold org access: org admins,
    // and providers with the manages_org_booking grant (the layout's
    // getOrgAdminContext re-checks authority server-side either way — a
    // provider without the grant just sees the access interstitial).
    const orgReturnTo = returnTo && returnTo.startsWith("/org/") ? returnTo : null;
    if (userType === "super_admin") {
      router.push("/admin/dashboard");
    } else if (userType === "org_admin" || userType === "provider") {
      if (orgReturnTo) {
        router.push(orgReturnTo);
      } else if (userType === "org_admin") {
        router.push("/org/dashboard");
      } else {
        router.push("/physician/dashboard");
      }
    } else {
      router.push("/physician/dashboard");
    }
    router.refresh();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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

      // A 202 is response.ok. Redirecting here would land on /org/dashboard with no session
      // cookie, which bounces straight back to this page — an unescapable loop for any
      // MFA-enabled admin. Hand off to the challenge form instead.
      if (data.mfaRequired && data.challengeToken) {
        setChallengeToken(data.challengeToken);
        setMfaMessage(data.message || "Enter the verification code we just sent you.");
        setLoading(false);
        return;
      }

      redirectByUserType(data.userType);
    } catch (err) {
      setError("An error occurred. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">
          Organization Admin Sign In
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          Sign in to access your organization dashboard.
        </p>

        {challengeToken ? (
          <MfaChallengeForm
            challengeToken={challengeToken}
            message={mfaMessage}
            onVerified={redirectByUserType}
          />
        ) : (
          <>
            {error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
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
          </>
        )}

        <p className="mt-6 text-xs text-slate-500 text-center">
          This application uses security safeguards and requires authentication to protect patient health information.
        </p>
      </div>
    </div>
  );
}
