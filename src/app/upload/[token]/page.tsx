"use client";

import { use, useEffect, useRef, useState } from "react";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface Validity {
  valid: boolean;
  state?: "valid" | "revoked" | "expired" | "completed";
  patientName?: string;
  clinicName?: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [loading, setLoading] = useState(true);
  const [validity, setValidity] = useState<Validity | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/uploads/${token}`);
        const data = await res.json();
        setValidity(data);
      } catch {
        setValidity({ valid: false });
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setError(null);
    const next = [...files];
    for (const f of Array.from(incoming)) {
      if (next.length >= MAX_FILES) {
        setError(`You can upload at most ${MAX_FILES} files.`);
        break;
      }
      if (f.size > MAX_FILE_BYTES) {
        setError(`"${f.name}" is larger than the 10 MB limit.`);
        continue;
      }
      const isImageOrPdf =
        f.type.startsWith("image/") || f.type === "application/pdf";
      if (!isImageOrPdf) {
        setError(`"${f.name}" is not an image or PDF.`);
        continue;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) {
        next.push(f);
      }
    }
    setFiles(next.slice(0, MAX_FILES));
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (!files.length) {
      setError("Please choose at least one file.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const res = await fetch(`/api/uploads/${token}`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Upload failed. Please try again.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Upload failed. Please try again.");
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
        ? "This upload link has expired. Please contact the clinic for a new one."
        : state === "completed"
          ? "Your documents have already been submitted. Thank you!"
          : "This upload link is not valid. Please contact the clinic.";
    return shell(
      <div className="text-center">
        <div className="text-4xl mb-3">{state === "completed" ? "✅" : "🔗"}</div>
        <h1 className="text-lg font-semibold text-slate-900 mb-2">
          {state === "completed" ? "Already received" : "Link unavailable"}
        </h1>
        <p className="text-sm text-slate-600">{message}</p>
      </div>,
    );
  }

  if (done) {
    return shell(
      <div className="text-center">
        <div className="text-4xl mb-3">✅</div>
        <h1 className="text-lg font-semibold text-slate-900 mb-2">Documents received</h1>
        <p className="text-sm text-slate-600">
          Thank you{validity.patientName ? `, ${validity.patientName.split(" ")[0]}` : ""}.
          Your files have been securely sent to {validity.clinicName}. You can close this page.
        </p>
      </div>,
    );
  }

  return shell(
    <>
      <h1 className="text-xl font-semibold text-slate-900">Upload your documents</h1>
      <p className="text-sm text-slate-600 mt-1">
        {validity.clinicName} has asked you to securely upload one or more documents
        (photo ID, images, or PDFs).
      </p>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        className="mt-5 border-2 border-dashed border-slate-300 rounded-xl px-4 py-8 text-center cursor-pointer hover:border-blue-400 hover:bg-slate-50 transition"
      >
        <div className="text-3xl mb-2">📎</div>
        <p className="text-sm font-medium text-slate-700">
          Tap to choose files, or take a photo
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Images or PDF · up to {MAX_FILES} files · 10 MB each
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-4 space-y-2">
          {files.map((f, idx) => (
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
                onClick={() => removeFile(idx)}
                className="text-xs text-red-600 hover:text-red-800 shrink-0"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || files.length === 0}
        className="mt-6 w-full bg-blue-600 text-white font-semibold rounded-lg px-4 py-3 hover:bg-blue-700 disabled:opacity-50 transition"
      >
        {submitting ? "Uploading…" : `Upload ${files.length || ""} ${files.length === 1 ? "file" : "files"}`.trim()}
      </button>

      <p className="mt-4 text-xs text-slate-400 text-center">
        Your files are sent directly to {validity.clinicName} and are not stored on this device.
      </p>
    </>,
  );
}
