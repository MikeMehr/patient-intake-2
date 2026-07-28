"use client";

import { use, useEffect, useState } from "react";

interface Validity {
  valid: boolean;
  state?: "valid" | "revoked" | "expired" | "pending" | "not_found" | "error";
  clinicName?: string;
  recipientName?: string | null;
  fileCount?: number;
}

interface DownloadFile {
  id: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  downloadUrl: string;
}

function humanSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DownloadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [loading, setLoading] = useState(true);
  const [validity, setValidity] = useState<Validity | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<DownloadFile[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/downloads/${token}`);
        const data = await res.json();
        setValidity(data);
      } catch {
        setValidity({ valid: false, state: "error" });
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) {
      setError("Please enter the passphrase.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/downloads/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not open the files. Please try again.");
        setSubmitting(false);
        return;
      }
      setFiles(data.files ?? []);
    } catch {
      setError("Could not open the files. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
        {children}
      </div>
    </div>
  );

  if (loading) {
    return shell(<p className="text-center text-slate-500">Loading…</p>);
  }

  if (!validity?.valid) {
    const state = validity?.state;
    const message =
      state === "expired"
        ? "This link has expired. Please contact the sender for a new one."
        : state === "revoked"
          ? "This link has been revoked by the sender."
          : state === "pending"
            ? "These files are not ready yet. Please try again shortly."
            : "This link is not valid. Please contact the sender.";
    return shell(
      <div className="text-center">
        <div className="text-4xl mb-3">🔗</div>
        <h1 className="text-lg font-semibold text-slate-900 mb-2">Link unavailable</h1>
        <p className="text-sm text-slate-600">{message}</p>
      </div>,
    );
  }

  if (files) {
    return shell(
      <>
        <div className="text-center mb-5">
          <div className="text-4xl mb-2">🔓</div>
          <h1 className="text-xl font-semibold text-slate-900">Your files</h1>
          <p className="text-sm text-slate-600 mt-1">
            Sent securely by {validity.clinicName}.
          </p>
        </div>
        {files.length === 0 ? (
          <p className="text-center text-sm text-slate-500">No files found.</p>
        ) : (
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f.id}>
                <a
                  href={f.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 hover:border-blue-400 hover:bg-white transition"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-lg">
                      {(f.contentType || "").startsWith("image/") ? "🖼️" : "📄"}
                    </span>
                    <span className="text-sm text-slate-800 truncate">
                      {f.filename ?? "File"}
                    </span>
                  </div>
                  <span className="text-xs text-blue-600 font-medium shrink-0">
                    Download{f.sizeBytes ? ` · ${humanSize(f.sizeBytes)}` : ""}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-5 text-xs text-slate-400 text-center">
          Download links are valid for a short time. Reload and re-enter the passphrase if
          they expire.
        </p>
      </>,
    );
  }

  return shell(
    <form onSubmit={submit}>
      <div className="text-center mb-5">
        <div className="text-4xl mb-2">🔒</div>
        <h1 className="text-xl font-semibold text-slate-900">Secure files</h1>
        <p className="text-sm text-slate-600 mt-1">
          {validity.clinicName} has sent you{" "}
          {validity.fileCount === 1 ? "a file" : `${validity.fileCount} files`}. Enter the
          passphrase they shared with you to open{" "}
          {validity.fileCount === 1 ? "it" : "them"}.
        </p>
      </div>

      <label className="block text-sm font-medium text-slate-600 mb-1">Passphrase</label>
      <input
        type="password"
        autoFocus
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        placeholder="Enter passphrase"
      />

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !passphrase}
        className="mt-6 w-full bg-blue-600 text-white font-semibold rounded-lg px-4 py-3 hover:bg-blue-700 disabled:opacity-50 transition"
      >
        {submitting ? "Opening…" : "Open files"}
      </button>

      <p className="mt-4 text-xs text-slate-400 text-center">
        The passphrase was shared with you separately by {validity.clinicName}.
      </p>
    </form>,
  );
}
