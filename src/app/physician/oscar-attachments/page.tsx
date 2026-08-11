"use client";

/**
 * Popup opened by the OSCAR eChart "Chart Attachment" button.
 *
 * Lists the files a patient attached when booking, and hands one at a time back
 * to the OSCAR page via window.opener.postMessage. The OSCAR page does the actual
 * upload, because it — and only it — holds the physician's OSCAR session. This
 * page never talks to OSCAR.
 *
 * The origin posted to comes from the server (allowedOpenerOrigin), never from
 * the URL, and is never "*".
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const INSERT_TYPE = "healthassist.document.insert";
const ACK_TYPE = "healthassist.document.ack";
const ACK_TIMEOUT_MS = 30000;

type PendingFile = {
  id: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  reason: string | null;
  appointmentAt: string | null;
};

type Outcome = { state: "idle" | "sending" | "done"; message?: string } | { state: "error"; message: string };

function formatBytes(n: number | null): string {
  if (n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function OscarAttachmentsInner() {
  const searchParams = useSearchParams();
  const demographicNo = searchParams.get("demographicNo") ?? "";
  const openerOrigin = searchParams.get("origin") ?? "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const allowedOriginRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ demographicNo });
    if (openerOrigin) qs.set("openerOrigin", openerOrigin);

    fetch(`/api/physician/oscar-attachments?${qs}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        allowedOriginRef.current = data.allowedOpenerOrigin ?? null;
        if (!res.ok) {
          setLoadError(data.error ?? "Could not load attachments.");
          return;
        }
        setFiles(data.files ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load attachments.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [demographicNo, openerOrigin]);

  const sendToOscar = useCallback(
    async (file: PendingFile) => {
      const targetOrigin = allowedOriginRef.current;
      if (!targetOrigin) {
        setOutcomes((p) => ({
          ...p,
          [file.id]: { state: "error", message: "This OSCAR server isn't authorized." },
        }));
        return;
      }
      if (!window.opener || window.opener.closed) {
        setOutcomes((p) => ({
          ...p,
          [file.id]: { state: "error", message: "The OSCAR chart window is closed. Reopen it and try again." },
        }));
        return;
      }

      setOutcomes((p) => ({ ...p, [file.id]: { state: "sending" } }));

      let buffer: ArrayBuffer;
      try {
        const res = await fetch(`/api/physician/oscar-attachments/${file.id}`);
        if (!res.ok) throw new Error("fetch failed");
        buffer = await res.arrayBuffer();
      } catch {
        setOutcomes((p) => ({
          ...p,
          [file.id]: { state: "error", message: "Could not read the file." },
        }));
        return;
      }

      const requestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Math.random()).slice(2);

      const result = await new Promise<{ ok: boolean; error?: string; documentNo?: string }>(
        (resolve) => {
          let settled = false;
          const cleanup = () => {
            window.removeEventListener("message", onMessage);
            window.clearTimeout(timer);
          };
          const settle = (r: { ok: boolean; error?: string; documentNo?: string }) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(r);
          };

          function onMessage(event: MessageEvent) {
            if (event.origin !== targetOrigin) return;
            const data = event.data as
              | { type?: string; requestId?: string; ok?: boolean; error?: string; documentNo?: string }
              | null;
            if (!data || data.type !== ACK_TYPE || data.requestId !== requestId) return;
            settle({ ok: Boolean(data.ok), error: data.error, documentNo: data.documentNo });
          }

          const timer = window.setTimeout(
            () => settle({ ok: false, error: "OSCAR did not respond." }),
            ACK_TIMEOUT_MS,
          );
          window.addEventListener("message", onMessage);

          try {
            // ArrayBuffer, not File/Blob — structured clone carries it reliably and the
            // OSCAR side rebuilds the File before posting it to the DMS form.
            window.opener.postMessage(
              {
                source: "healthassist",
                type: INSERT_TYPE,
                version: 1,
                requestId,
                demographicNo,
                filename: file.filename || "attachment",
                contentType: file.contentType || "application/octet-stream",
                description: file.reason || "Patient booking attachment",
                buffer,
              },
              targetOrigin,
              [buffer],
            );
          } catch {
            settle({ ok: false, error: "Could not reach the OSCAR window." });
          }
        },
      );

      if (!result.ok) {
        setOutcomes((p) => ({
          ...p,
          [file.id]: { state: "error", message: result.error ?? "OSCAR rejected the upload." },
        }));
        return;
      }

      // Only now is it really in the chart, so only now is it marked imported.
      await fetch(`/api/physician/oscar-attachments/${file.id}/imported`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oscarDocumentNo: result.documentNo ?? null }),
      }).catch(() => {});

      setOutcomes((p) => ({ ...p, [file.id]: { state: "done" } }));
    },
    [demographicNo],
  );

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-lg font-semibold text-slate-900">Booking attachments</h1>
        <p className="mt-1 text-sm text-slate-600">
          Files this patient attached when they booked. Filing one adds it to their OSCAR chart
          under Documents.
        </p>

        {loading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

        {!loading && loadError && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {!loading && !loadError && files.length === 0 && (
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Nothing waiting to be filed for this patient.
          </div>
        )}

        {!loading && !loadError && files.length > 0 && (
          <ul className="mt-6 space-y-3">
            {files.map((file) => {
              const outcome = outcomes[file.id] ?? { state: "idle" as const };
              return (
                <li
                  key={file.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 flex items-start justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 break-all">
                      {file.filename ?? "Attachment"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[
                        formatBytes(file.sizeBytes),
                        file.appointmentAt ? `booked ${formatDate(file.appointmentAt)}` : "",
                        file.reason ?? "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {outcome.state === "error" && (
                      <p className="mt-1 text-xs text-red-600">{outcome.message}</p>
                    )}
                  </div>

                  {outcome.state === "done" ? (
                    <span className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                      ✓ Filed
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => sendToOscar(file)}
                      disabled={outcome.state === "sending"}
                      className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {outcome.state === "sending" ? "Filing…" : "File to chart"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}

export default function OscarAttachmentsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50 p-6" />}>
      <OscarAttachmentsInner />
    </Suspense>
  );
}
