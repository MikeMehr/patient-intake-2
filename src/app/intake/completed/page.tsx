"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const AUTO_REDIRECT_MS = 30000;

export default function IntakeCompletedPage() {
  const router = useRouter();
  const [secondsRemaining, setSecondsRemaining] = useState(
    Math.ceil(AUTO_REDIRECT_MS / 1000),
  );

  const redirectSeconds = useMemo(
    () => Math.max(1, Math.ceil(AUTO_REDIRECT_MS / 1000)),
    [],
  );

  useEffect(() => {
    const startTs = Date.now();
    const interval = window.setInterval(() => {
      const elapsedMs = Date.now() - startTs;
      const nextSeconds = Math.max(0, Math.ceil((AUTO_REDIRECT_MS - elapsedMs) / 1000));
      setSecondsRemaining(nextSeconds);
    }, 1000);

    const timeout = window.setTimeout(() => {
      router.replace("/");
    }, AUTO_REDIRECT_MS);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <main className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Submission received</h1>
        <p className="mt-3 text-sm text-slate-700">
          Thank you. Your intake has been submitted to your physician.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          For your privacy, please close this browser tab now.
        </p>
        <p className="mt-4 text-xs text-slate-500">
          This page auto-redirects in {secondsRemaining || redirectSeconds} seconds.
        </p>
        <button
          type="button"
          onClick={() => router.replace("/")}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Return to home
        </button>
      </main>
    </div>
  );
}
