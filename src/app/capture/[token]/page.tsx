"use client";

/**
 * Phone side of the QR photo bridge. Opened by scanning the QR code shown on
 * the physician transcription page; the token in the URL is the credential.
 * Takes/picks one photo, downscales it to a JPEG client-side, and posts it to
 * /api/capture/[token] for the desktop to claim.
 */

import { use, useEffect, useRef, useState } from "react";

// Longest edge after downscaling — plenty of detail for clinical review while
// keeping uploads to ~1 MB even on a 48 MP camera.
const MAX_DIMENSION = 2560;
const JPEG_QUALITY = 0.85;

type PageState = "checking" | "ready" | "sending" | "sent" | "invalid" | "expired";

async function downscaleToJpeg(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
  } catch {
    // e.g. HEIC the browser can't decode — fall back to uploading the original.
    return null;
  }
}

export default function PhoneCapturePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<PageState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{ blob: Blob; mime: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/capture/${token}`);
        const data = await res.json();
        if (data.valid) setState("ready");
        else setState(data.reason === "expired" ? "expired" : "invalid");
      } catch {
        setState("invalid");
      }
    })();
  }, [token]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);

    const jpeg = await downscaleToJpeg(file);
    const blob = jpeg ?? file;
    const mime = jpeg ? "image/jpeg" : file.type || "image/jpeg";
    if (blob.size > 20 * 1024 * 1024) {
      setError("That photo is too large (max 20 MB). Try taking it with the camera instead.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(blob));
    setPendingUpload({ blob, mime, name: jpeg ? "phone-photo.jpg" : file.name || "phone-photo" });
  }

  async function handleSend() {
    if (!pendingUpload || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const formData = new FormData();
      formData.append("photo", new File([pendingUpload.blob], pendingUpload.name, { type: pendingUpload.mime }));
      const res = await fetch(`/api/capture/${token}`, { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not send the photo. Please try again.");
        setState(res.status === 404 || res.status === 410 ? "expired" : "ready");
        return;
      }
      setState("sent");
    } catch {
      setError("Could not send the photo. Check your connection and try again.");
      setState("ready");
    }
  }

  function resetForRetake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPendingUpload(null);
    setError(null);
    setState("ready");
    inputRef.current?.click();
  }

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm border border-slate-200 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Send a photo</h1>

        {state === "checking" && (
          <p className="mt-4 text-sm text-slate-500">Checking your code…</p>
        )}

        {(state === "invalid" || state === "expired") && (
          <p className="mt-4 text-sm text-slate-600">
            {state === "expired"
              ? "This code has expired or was already used. Generate a new QR code on your computer and scan it again."
              : "This link is not valid. Generate a new QR code on your computer and scan it again."}
          </p>
        )}

        {(state === "ready" || state === "sending") && (
          <>
            <p className="mt-2 text-sm text-slate-500">
              The photo will appear on your computer automatically.
            </p>

            {previewUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Photo preview"
                  className="mt-4 w-full rounded-xl border border-slate-200 object-contain max-h-80"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={state === "sending"}
                  className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-base font-medium text-white disabled:opacity-60"
                >
                  {state === "sending" ? "Sending…" : "Use this photo"}
                </button>
                <button
                  type="button"
                  onClick={resetForRetake}
                  disabled={state === "sending"}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-medium text-slate-700 disabled:opacity-60"
                >
                  Retake
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-4 text-base font-medium text-white"
              >
                📷 Take photo
              </button>
            )}
          </>
        )}

        {state === "sent" && (
          <>
            <div className="mt-4 text-4xl">✅</div>
            <p className="mt-2 text-sm text-slate-600">
              Photo sent — it will appear on your computer in a moment. You can close this page.
            </p>
          </>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={handleFileChange}
        />
      </div>
    </main>
  );
}
