"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface DocFile {
  id: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
}

interface DocRequest {
  id: string;
  patientName: string;
  patientEmail: string;
  status: "completed" | "revoked" | "expired" | "pending";
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
  files: DocFile[];
}

function formatDT(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: DocRequest["status"] }) {
  const map: Record<DocRequest["status"], { label: string; cls: string }> = {
    completed: { label: "Received", cls: "bg-green-100 text-green-700" },
    pending: { label: "Awaiting upload", cls: "bg-blue-100 text-blue-700" },
    expired: { label: "Expired", cls: "bg-slate-100 text-slate-500" },
    revoked: { label: "Revoked", cls: "bg-slate-100 text-slate-500" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default function OrgDocumentsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/org/documents");
      if (res.status === 401) {
        router.push("/org/login");
        return;
      }
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch {
      setError("Failed to load document requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/org/documents/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientName, patientEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/org/login");
        return;
      }
      if (!res.ok) {
        setError(data.error || "Could not send the request.");
        setSending(false);
        return;
      }
      setNotice(
        data.emailSent
          ? `Upload link emailed to ${patientEmail}.`
          : `Request created.${data.uploadUrl ? ` Link: ${data.uploadUrl}` : " Email was not sent (email service off)."}`,
      );
      setPatientName("");
      setPatientEmail("");
      await load();
    } catch {
      setError("Could not send the request.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Patient Documents</h1>
            <p className="text-sm text-slate-600 mt-1">
              Request documents from a patient and view what they upload.
            </p>
          </div>
          <Link
            href="/org/dashboard"
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            ← Dashboard
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {notice && (
          <div className="mb-6 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
            <p className="text-sm text-green-800 break-all">{notice}</p>
          </div>
        )}

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Request documents</h2>
          <form onSubmit={sendRequest} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Patient name
              </label>
              <input
                type="text"
                required
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                placeholder="Jane Doe"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Patient email
              </label>
              <input
                type="email"
                required
                value={patientEmail}
                onChange={(e) => setPatientEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                placeholder="jane@example.com"
              />
            </div>
            <div className="sm:col-span-1 flex items-end">
              <button
                type="submit"
                disabled={sending}
                className="w-full bg-slate-900 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-slate-800 disabled:opacity-50 transition"
              >
                {sending ? "Sending…" : "Send secure link"}
              </button>
            </div>
          </form>
          <p className="text-xs text-slate-400 mt-3">
            The patient gets a one-time link (expires in 7 days) to upload images or PDFs.
          </p>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">
              Requests ({requests.length})
            </h2>
          </div>
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-slate-500">Loading…</div>
          ) : requests.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-slate-500">
              No document requests yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {requests.map((r) => (
                <div key={r.id} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-900">{r.patientName}</p>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{r.patientEmail}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Sent {formatDT(r.createdAt)}
                        {r.status === "pending" && ` · expires ${formatDT(r.expiresAt)}`}
                      </p>
                    </div>
                  </div>
                  {r.files.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {r.files.map((f) => (
                        <li key={f.id}>
                          <a
                            href={`/api/org/documents/files/${f.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 hover:border-blue-400 hover:text-blue-700 transition"
                            title={f.filename ?? "Document"}
                          >
                            <span>{(f.contentType || "").startsWith("image/") ? "🖼️" : "📄"}</span>
                            <span className="max-w-[180px] truncate">
                              {f.filename ?? "Document"}
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
