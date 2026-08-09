"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useOrgSession } from "@/components/auth/OrgSessionContext";

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
  requestNote: string | null;
  status: "completed" | "revoked" | "expired" | "pending";
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
  files: DocFile[];
}

interface ShareFile {
  id: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  confirmed: boolean;
}

interface DocShare {
  id: string;
  recipientName: string | null;
  recipientEmail: string | null;
  status: "completed" | "revoked" | "expired" | "pending";
  expiresAt: string;
  completedAt: string | null;
  downloadCount: number;
  lastDownloadedAt: string | null;
  createdAt: string;
  files: ShareFile[];
}

const MAX_SEND_FILES = 10;
const MAX_SEND_BYTES = 200 * 1024 * 1024;

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

function humanSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function generatePassphrase(): string {
  // 16 unambiguous chars from a CSPRNG — strong, easy to read over the phone.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function RequestBadge({ status }: { status: DocRequest["status"] }) {
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

function ShareBadge({ status }: { status: DocShare["status"] }) {
  const map: Record<DocShare["status"], { label: string; cls: string }> = {
    completed: { label: "Ready", cls: "bg-green-100 text-green-700" },
    pending: { label: "Incomplete", cls: "bg-amber-100 text-amber-700" },
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

/**
 * submitShare makes three network calls — create share, upload each file, finalize — and
 * used to collapse all three into one catch, so "Something went wrong" could equally mean a
 * 500 from our API, a blocked CORS preflight, or a failed email. The step and the
 * developer-facing detail now travel with the error so the banner can say which.
 */
type ShareStep = "create" | "upload" | "finalize";

class ShareStepError extends Error {
  readonly step: ShareStep;
  readonly userMessage: string;
  readonly detail: string;
  constructor(step: ShareStep, userMessage: string, detail: string) {
    super(detail);
    this.name = "ShareStepError";
    this.step = step;
    this.userMessage = userMessage;
    this.detail = detail;
  }
}

/** Azure reports errors as <Error><Code>X</Code><Message>…</Message></Error>. */
function azureErrorCode(body: string): string | null {
  return /<Code>([^<]+)<\/Code>/.exec(body || "")?.[1] ?? null;
}

/**
 * Upload one file directly to Azure Blob via its write-SAS URL, reporting progress.
 *
 * `label` is a PHI-free position marker ("file 2 of 5"). The filename and the URL are
 * deliberately kept out of the logged detail — the URL carries a live SAS (a bearer
 * credential) and the blob path embeds the filename.
 */
function putToAzure(
  url: string,
  file: File,
  contentType: string,
  label: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-ms-blob-type", "BlockBlob");
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // A real response means CORS passed and storage itself rejected the write: an
      // expired or malformed SAS, a missing container, a size limit. Azure's <Code> and
      // x-ms-request-id are the two things that make that diagnosable, and the account's
      // ExposedHeaders rule is what lets us read the header at all.
      const code = azureErrorCode(xhr.responseText);
      reject(
        new ShareStepError(
          "upload",
          `"${file.name}" was rejected by secure file storage${code ? ` (${code})` : ""}. Nothing was sent.`,
          `PUT blob -> ${xhr.status} ${xhr.statusText} | ${label} | azure-code=${code ?? "unknown"} | ` +
            `x-ms-request-id=${xhr.getResponseHeader("x-ms-request-id") ?? "n/a"}`,
        ),
      );
    };

    xhr.onerror = () => {
      // status 0, no headers, no body: the request never completed at the network layer,
      // so there is nothing to report but the shape of the failure. On this flow that is
      // almost always the CORS preflight being refused — the storage account has no rule
      // allowing PUT from this site's origin, which is exactly how this broke when the
      // dashboard moved to a new domain. navigator.onLine rules out the one other
      // realistic cause, so we can name the likely one instead of guessing.
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      let blobHost = "unknown";
      try {
        blobHost = new URL(url).host;
      } catch {
        /* keep the placeholder */
      }
      reject(
        new ShareStepError(
          "upload",
          offline
            ? "Your connection dropped during the upload, so nothing was sent. Check your internet and try again."
            : "The browser could not reach secure file storage, so nothing was sent. This is a setup " +
              "issue on our side — file storage is not accepting uploads from this web address — not a " +
              "problem with your files.",
          `XHR error, status=0, no response (blocked at the network layer) | ${label} | ` +
            `blob host=${blobHost} | page origin=${window.location.origin} | navigator.onLine=${!offline} | ` +
            `Most likely: no blob CORS rule allows PUT from ${window.location.origin}. ` +
            `Check: az storage cors list --services b --account-name <account>`,
        ),
      );
    };

    xhr.ontimeout = () =>
      reject(
        new ShareStepError(
          "upload",
          `"${file.name}" timed out while uploading, so nothing was sent.`,
          `XHR timeout after ${xhr.timeout}ms | ${label}`,
        ),
      );

    xhr.send(file);
  });
}

export default function OrgDocumentsPage() {
  const router = useRouter();
  // Resolved server-side by src/app/org/(protected)/layout.tsx — no /api/auth/me round trip.
  const orgSession = useOrgSession();
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [shares, setShares] = useState<DocShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Request documents (inbound)
  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [sending, setSending] = useState(false);

  // Send files (outbound)
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [sendFiles, setSendFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; pct: number } | null>(
    null,
  );
  const [shareResult, setShareResult] = useState<{ url: string; emailSent: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Prefill from an OSCAR eChart launch (?demographicNo=…, set by the
   * "Request Docs" button — see public/oscar/echart-transcribe.js). Resolves
   * the demographic to the patient's name/email through the same route the
   * Transcribe launch uses. Best-effort on purpose: the route is provider-only
   * (an org-admin session gets 403) and the patient may be unknown — in every
   * failure case the forms simply stay blank and the page works as before.
   */
  useEffect(() => {
    const demographicNo = new URLSearchParams(window.location.search).get("demographicNo") ?? "";
    if (!/^[0-9]{1,12}$/.test(demographicNo)) return;
    // Strip the identifier from the address bar and history once captured.
    try {
      window.history.replaceState({}, "", "/org/documents");
    } catch {}
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/physician/oscar-launch/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ demographicNo }),
        });
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (cancelled || data?.status !== "resolved" || !data.patient?.fullName) return;
        const name: string = data.patient.fullName;
        const email: string = data.patient.email || "";
        // Never overwrite something the user already typed.
        setPatientName((v) => v || name);
        setPatientEmail((v) => v || email);
        setRecipientName((v) => v || name);
        setRecipientEmail((v) => v || email);
        setNotice(
          email
            ? `Patient loaded from the OSCAR eChart: ${name}`
            : `Patient loaded from the OSCAR eChart: ${name} — no email on file, enter one below.`,
        );
      } catch {
        /* prefill is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Two-tier errors. `message` is what a clinician reads — calm, honest, and it always says
   * whether anything was actually sent. `detail` is the one line a developer needs, kept
   * behind a disclosure and mirrored to console.error so it survives a screenshot-only bug
   * report. Console is the right sink here: logDebug is a no-op in production (see
   * src/lib/secure-logger.ts), so the repo's request-id logging would emit nothing in prod.
   */
  const showError = (message: string, detail?: string) => {
    setError(message);
    setErrorDetail(detail ?? null);
    if (detail) console.error("[org/documents]", detail);
  };

  const clearError = () => {
    setError(null);
    setErrorDetail(null);
  };

  const load = async () => {
    try {
      const [reqRes, shareRes] = await Promise.all([
        fetch("/api/org/documents"),
        fetch("/api/org/documents/shares"),
      ]);
      if (reqRes.status === 401 || shareRes.status === 401) {
        router.push("/org/login");
        return;
      }
      const reqData = await reqRes.json();
      const shareData = await shareRes.json();
      setRequests(reqData.requests ?? []);
      setShares(shareData.shares ?? []);
    } catch (err) {
      showError("Failed to load documents.", `GET /api/org/documents -> ${String(err)}`);
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
    clearError();
    setNotice(null);
    try {
      const res = await fetch("/api/org/documents/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientName, patientEmail, requestNote: requestNote || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/org/login");
        return;
      }
      if (!res.ok) {
        showError(
          data.error || "Could not send the request.",
          `POST /api/org/documents/send -> ${res.status}`,
        );
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
      setRequestNote("");
      await load();
    } catch (err) {
      showError(
        "Could not reach the server to send the request. Nothing was sent — check your connection and try again.",
        `POST /api/org/documents/send -> ${String(err)}`,
      );
    } finally {
      setSending(false);
    }
  };

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    clearError();
    const next = [...sendFiles];
    for (const f of Array.from(incoming)) {
      if (next.length >= MAX_SEND_FILES) {
        showError(`You can send at most ${MAX_SEND_FILES} files.`);
        break;
      }
      if (f.size > MAX_SEND_BYTES) {
        showError(`"${f.name}" is larger than the 200 MB limit.`);
        continue;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setSendFiles(next.slice(0, MAX_SEND_FILES));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeSendFile = (idx: number) => {
    setSendFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const submitShare = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setNotice(null);
    setShareResult(null);
    if (passphrase.length < 6) {
      showError("Passphrase must be at least 6 characters.");
      return;
    }
    if (!sendFiles.length) {
      showError("Add at least one file to send.");
      return;
    }
    setUploading(true);
    // Which of the three calls we are in, so a bare fetch() rejection — which carries no
    // step of its own — is still attributed correctly by the catch below.
    let step: ShareStep = "create";
    try {
      // 1. Create the share and reserve write-SAS URLs.
      const createRes = await fetch("/api/org/documents/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientName: recipientName || undefined,
          recipientEmail: recipientEmail || undefined,
          passphrase,
          files: sendFiles.map((f) => ({
            filename: f.name,
            contentType: f.type,
            sizeBytes: f.size,
          })),
        }),
      });
      if (createRes.status === 401) {
        router.push("/org/login");
        return;
      }
      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        showError(
          createData.error || "Could not start the share.",
          `POST /api/org/documents/shares -> ${createRes.status}`,
        );
        return;
      }

      const { shareId, token, uploads } = createData as {
        shareId: string;
        token: string;
        uploads: { fileId: string; writeSasUrl: string; contentType: string }[];
      };

      // 2. Upload each file directly to Azure, in order.
      step = "upload";
      for (let i = 0; i < sendFiles.length; i++) {
        setProgress({ current: i + 1, total: sendFiles.length, pct: 0 });
        await putToAzure(
          uploads[i].writeSasUrl,
          sendFiles[i],
          uploads[i].contentType,
          `file ${i + 1} of ${sendFiles.length}`,
          (frac) =>
            setProgress({ current: i + 1, total: sendFiles.length, pct: Math.round(frac * 100) }),
        );
      }
      setProgress(null);

      // 3. Finalize — confirms blobs landed and emails the link if a recipient was given.
      step = "finalize";
      const finRes = await fetch(`/api/org/documents/shares/${shareId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const finData = await finRes.json().catch(() => ({}));
      if (!finRes.ok) {
        showError(
          finData.error || "Upload finished but the share could not be published.",
          `POST /api/org/documents/shares/${shareId}/finalize -> ${finRes.status}`,
        );
        await load();
        return;
      }

      setShareResult({ url: finData.downloadUrl, emailSent: !!finData.emailSent });
      setRecipientName("");
      setRecipientEmail("");
      setPassphrase("");
      setSendFiles([]);
      await load();
    } catch (err) {
      // A ShareStepError already knows what to say. Anything else reaching here is a fetch()
      // rejection — the server was unreachable — and which call it was changes the advice
      // materially: after a successful upload the bytes ARE in storage, so telling the
      // clinician to just re-send would silently create a duplicate share.
      const failedStep = err instanceof ShareStepError ? err.step : step;
      const fallback: Record<ShareStep, string> = {
        create:
          "Could not reach the server to start the send. Nothing was sent — check your connection and try again.",
        upload: "The upload could not be completed, so nothing was sent. Please try again.",
        finalize:
          "Your files uploaded, but we could not reach the server to publish the link. " +
          "Check the sent-files list below before sending again, so you do not create a duplicate.",
      };
      const message = err instanceof ShareStepError ? err.userMessage : fallback[failedStep];
      const detail =
        err instanceof ShareStepError
          ? err.detail
          : err instanceof Error
            ? `${err.name}: ${err.message}`
            : String(err);
      showError(message, `[step: ${failedStep}] ${detail}`);
      if (failedStep === "finalize") await load();
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const revokeShare = async (id: string) => {
    clearError();
    try {
      const res = await fetch(`/api/org/documents/shares/${id}/revoke`, { method: "POST" });
      if (res.status === 401) {
        router.push("/org/login");
        return;
      }
      if (!res.ok) {
        showError("Could not revoke the link.", `POST .../shares/${id}/revoke -> ${res.status}`);
        return;
      }
      await load();
    } catch (err) {
      showError("Could not revoke the link.", `POST .../shares/${id}/revoke -> ${String(err)}`);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard.");
    } catch {
      setNotice(text);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Patient Documents</h1>
            <p className="text-sm text-slate-600 mt-1">
              Request documents from a patient, or send files securely to anyone.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Same session, no switch — AI Scribe can stay open in another tab. */}
            {orgSession?.canAccessPhysicianDashboard && (
              <Link
                href="/physician/dashboard"
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                AI Scribe
              </Link>
            )}
            <Link
              href="/org/dashboard"
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              ← Dashboard
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-800">{error}</p>
            {errorDetail && (
              <details className="mt-2">
                <summary className="text-xs text-red-600 cursor-pointer select-none">
                  Technical details (for support)
                </summary>
                <p className="mt-1 text-xs font-mono text-red-700 break-all whitespace-pre-wrap">
                  {errorDetail}
                </p>
              </details>
            )}
          </div>
        )}
        {notice && (
          <div className="mb-6 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
            <p className="text-sm text-green-800 break-all">{notice}</p>
          </div>
        )}

        {/* Request documents (inbound) */}
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
            <div className="sm:col-span-3">
              <label className="block text-sm font-medium text-slate-600 mb-1">
                What are you requesting?{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                rows={2}
                maxLength={500}
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none resize-y"
                placeholder="Photo of the eyelid swelling, or a PDF of your last lab results"
              />
            </div>
            <div className="sm:col-span-3 flex sm:justify-end">
              <button
                type="submit"
                disabled={sending}
                className="w-full sm:w-auto bg-slate-900 text-white text-sm font-medium rounded-lg px-6 py-2 hover:bg-slate-800 disabled:opacity-50 transition"
              >
                {sending ? "Sending…" : "Send secure link"}
              </button>
            </div>
          </form>
          <p className="text-xs text-slate-400 mt-3">
            The patient gets a one-time link (expires in 7 days) to upload images or PDFs.
            Anything you write above is shown in the email and on the upload page.
          </p>
        </div>

        {/* Send files (outbound) */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Send files</h2>
          <p className="text-sm text-slate-600 mb-4">
            Share files with anyone via a passphrase-protected link. Files are encrypted at
            rest and only open with the passphrase you set.
          </p>

          {shareResult && (
            <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
              <p className="text-sm font-medium text-blue-900">Secure link ready</p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  readOnly
                  value={shareResult.url}
                  className="flex-1 rounded border border-blue-200 bg-white px-2 py-1 text-xs text-slate-700"
                />
                <button
                  onClick={() => copy(shareResult.url)}
                  className="text-xs font-medium text-blue-700 hover:text-blue-900 shrink-0"
                >
                  Copy
                </button>
              </div>
              <p className="mt-2 text-xs text-blue-800">
                {shareResult.emailSent
                  ? "The link was emailed to the recipient. "
                  : ""}
                ⚠️ Share the passphrase separately (e.g. by phone) — never in the same message
                as the link.
              </p>
            </div>
          )}

          <form onSubmit={submitShare} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Recipient name <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  placeholder="Dr. Smith / REACH Medical"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Recipient email <span className="text-slate-400">(optional — emails the link)</span>
                </label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  placeholder="office@example.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Passphrase</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-blue-400 focus:outline-none"
                  placeholder="At least 6 characters"
                />
                <button
                  type="button"
                  onClick={() => setPassphrase(generatePassphrase())}
                  className="text-xs font-medium text-blue-700 hover:text-blue-900 shrink-0 whitespace-nowrap"
                >
                  Generate
                </button>
                {passphrase && (
                  <button
                    type="button"
                    onClick={() => copy(passphrase)}
                    className="text-xs font-medium text-slate-600 hover:text-slate-900 shrink-0"
                  >
                    Copy
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                The recipient must enter this to open the files. Give it to them separately.
              </p>
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              className="border-2 border-dashed border-slate-300 rounded-xl px-4 py-6 text-center cursor-pointer hover:border-blue-400 hover:bg-slate-50 transition"
            >
              <div className="text-2xl mb-1">📎</div>
              <p className="text-sm font-medium text-slate-700">
                Tap to choose files, or drag them here
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Any file type · up to {MAX_SEND_FILES} files · 200 MB each
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>

            {sendFiles.length > 0 && (
              <ul className="space-y-2">
                {sendFiles.map((f, idx) => (
                  <li
                    key={`${f.name}-${idx}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800 truncate">{f.name}</p>
                      <p className="text-xs text-slate-500">{humanSize(f.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSendFile(idx)}
                      disabled={uploading}
                      className="text-xs text-red-600 hover:text-red-800 shrink-0 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {progress && (
              <div>
                <p className="text-xs text-slate-500 mb-1">
                  Uploading file {progress.current} of {progress.total} — {progress.pct}%
                </p>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={uploading}
              className="w-full sm:w-auto bg-blue-600 text-white text-sm font-semibold rounded-lg px-6 py-2.5 hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {uploading ? "Sending…" : "Create secure link"}
            </button>
            <p className="text-xs text-slate-400">
              The link expires in 7 days. Files are uploaded straight to secure storage.
            </p>
          </form>
        </div>

        {/* Sent files list */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">Sent files ({shares.length})</h2>
          </div>
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-slate-500">Loading…</div>
          ) : shares.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-slate-500">
              No files sent yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {shares.map((s) => (
                <div key={s.id} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-900">
                          {s.recipientName || s.recipientEmail || "Secure link"}
                        </p>
                        <ShareBadge status={s.status} />
                      </div>
                      {s.recipientEmail && (
                        <p className="text-xs text-slate-500 mt-0.5">{s.recipientEmail}</p>
                      )}
                      <p className="text-xs text-slate-400 mt-0.5">
                        Sent {formatDT(s.createdAt)}
                        {s.status !== "expired" &&
                          s.status !== "revoked" &&
                          ` · expires ${formatDT(s.expiresAt)}`}
                        {s.downloadCount > 0 &&
                          ` · opened ${s.downloadCount}×${s.lastDownloadedAt ? ` (last ${formatDT(s.lastDownloadedAt)})` : ""}`}
                      </p>
                    </div>
                    {(s.status === "completed" || s.status === "pending") && (
                      <button
                        onClick={() => revokeShare(s.id)}
                        className="text-xs font-medium text-red-600 hover:text-red-800 shrink-0"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                  {s.files.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {s.files.map((f) => (
                        <li
                          key={f.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700"
                          title={f.filename ?? "File"}
                        >
                          <span>{(f.contentType || "").startsWith("image/") ? "🖼️" : "📄"}</span>
                          <span className="max-w-[180px] truncate">{f.filename ?? "File"}</span>
                          {f.sizeBytes != null && (
                            <span className="text-slate-400">{humanSize(f.sizeBytes)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Requests list (inbound) */}
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
                        <RequestBadge status={r.status} />
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{r.patientEmail}</p>
                      {r.requestNote?.trim() && (
                        <p
                          className="text-xs text-slate-600 mt-1 line-clamp-2"
                          title={r.requestNote}
                        >
                          Asked for: {r.requestNote}
                        </p>
                      )}
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
