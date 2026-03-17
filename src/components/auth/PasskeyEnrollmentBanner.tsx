"use client";

import { useEffect, useState } from "react";

export default function PasskeyEnrollmentBanner() {
  const [visible, setVisible] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // Don't show if dismissed this session
    if (sessionStorage.getItem("passkey-banner-dismissed")) return;

    // Check browser support
    import("@simplewebauthn/browser").then(({ browserSupportsWebAuthn }) => {
      if (!browserSupportsWebAuthn()) return;

      // Check if user already has passkeys
      fetch("/api/auth/webauthn/credentials")
        .then((res) => res.json())
        .then((data) => {
          if (!data.credentials || data.credentials.length === 0) {
            setVisible(true);
          }
        })
        .catch(() => {});
    });
  }, []);

  if (!visible) return null;

  const handleSetup = async () => {
    setRegistering(true);
    setMessage(null);
    try {
      const { registerPasskey } = await import("@/lib/webauthn-client");
      const result = await registerPasskey("My device");
      if (result.success) {
        setMessage("Passkey registered successfully! You can now sign in with Face ID or Touch ID.");
        setTimeout(() => setVisible(false), 3000);
      } else {
        setMessage(result.error || "Registration failed. Please try again.");
      }
    } catch {
      setMessage("An error occurred. Please try again.");
    }
    setRegistering(false);
  };

  const handleDismiss = () => {
    sessionStorage.setItem("passkey-banner-dismissed", "1");
    setVisible(false);
  };

  return (
    <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-start gap-3">
        <svg
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
          />
        </svg>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-blue-900">
            Set up passkey sign-in
          </h3>
          <p className="mt-1 text-sm text-blue-800">
            Use Face ID, Touch ID, or a security key to sign in faster and more securely.
          </p>
          {message && (
            <p className={`mt-2 text-sm ${message.includes("successfully") ? "text-emerald-700" : "text-red-700"}`}>
              {message}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSetup}
              disabled={registering}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {registering ? "Setting up..." : "Set up now"}
            </button>
            <button
              onClick={handleDismiss}
              disabled={registering}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
