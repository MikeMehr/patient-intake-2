"use client";

import { useEffect, useState } from "react";

type PasskeyCredential = {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export default function PasskeyManagement() {
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  const fetchCredentials = async () => {
    try {
      const res = await fetch("/api/auth/webauthn/credentials");
      const data = await res.json();
      setCredentials(data.credentials || []);
    } catch {
      // Silently fail
    }
    setLoading(false);
  };

  useEffect(() => {
    import("@simplewebauthn/browser").then(({ browserSupportsWebAuthn }) => {
      setSupported(browserSupportsWebAuthn());
    });
    fetchCredentials();
  }, []);

  const handleRegister = async () => {
    setRegistering(true);
    setMessage(null);
    try {
      const { registerPasskey } = await import("@/lib/webauthn-client");
      const result = await registerPasskey();
      if (result.success) {
        setMessage("Passkey added successfully.");
        await fetchCredentials();
      } else {
        setMessage(result.error || "Registration failed.");
      }
    } catch {
      setMessage("An error occurred.");
    }
    setRegistering(false);
  };

  const handleDelete = async (credentialId: string) => {
    if (!confirm("Remove this passkey? You will no longer be able to sign in with it.")) return;
    try {
      const res = await fetch("/api/auth/webauthn/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId }),
      });
      if (res.ok) {
        setCredentials((prev) => prev.filter((c) => c.id !== credentialId));
        setMessage("Passkey removed.");
      }
    } catch {
      setMessage("Failed to remove passkey.");
    }
  };

  if (loading) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-base font-semibold text-slate-900">Passkeys</h3>
      <p className="mt-1 text-sm text-slate-600">
        Sign in with Face ID, Touch ID, or a security key.
      </p>

      {message && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${message.includes("success") ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          {message}
        </div>
      )}

      {credentials.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100">
          {credentials.map((cred) => (
            <li key={cred.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">{cred.deviceName}</p>
                <p className="text-xs text-slate-500">
                  Added {new Date(cred.createdAt).toLocaleDateString()}
                  {cred.lastUsedAt && ` · Last used ${new Date(cred.lastUsedAt).toLocaleDateString()}`}
                </p>
              </div>
              <button
                onClick={() => handleDelete(cred.id)}
                className="text-sm text-red-600 hover:text-red-800"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {supported && (
        <button
          onClick={handleRegister}
          disabled={registering}
          className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {registering ? "Adding passkey..." : credentials.length > 0 ? "Add another passkey" : "Add a passkey"}
        </button>
      )}

      {!supported && credentials.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">
          Your browser does not support passkeys. Try using Safari or Chrome on a supported device.
        </p>
      )}
    </div>
  );
}
