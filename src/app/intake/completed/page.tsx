"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

const AUTO_REDIRECT_MS = 30000;
const DEFAULT_REDIRECT_URL = "https://www.health-assist.org/";

/**
 * Domains that are allowed as post-intake redirect targets.
 * The `organizationWebsiteUrl` field set by clinic admins is the only
 * other source of redirect URLs — restricting to this allowlist prevents
 * open-redirect phishing even if a malicious or compromised admin sets
 * an arbitrary URL.
 */
const ALLOWED_REDIRECT_HOSTS = new Set([
  "health-assist.org",
  "www.health-assist.org",
  "mymd.health-assist.org",
]);

function resolveRedirectUrl(raw: string | null): string {
  const value = (raw || "").trim();
  if (!value) return DEFAULT_REDIRECT_URL;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return DEFAULT_REDIRECT_URL;
    if (!ALLOWED_REDIRECT_HOSTS.has(parsed.hostname)) return DEFAULT_REDIRECT_URL;
    return parsed.toString();
  } catch {
    return DEFAULT_REDIRECT_URL;
  }
}

// ---------------------------------------------------------------------------
// Star rating sub-component
// ---------------------------------------------------------------------------

function StarRating({
  value,
  hovered,
  onRate,
  onHover,
  onLeave,
}: {
  value: number;
  hovered: number;
  onRate: (n: number) => void;
  onHover: (n: number) => void;
  onLeave: () => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= (hovered || value);
        return (
          <button
            key={star}
            type="button"
            aria-label={`${star} star${star !== 1 ? "s" : ""}`}
            onClick={() => onRate(star)}
            onMouseEnter={() => onHover(star)}
            onMouseLeave={onLeave}
            className={`text-3xl leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded ${
              active ? "text-amber-400" : "text-slate-300 hover:text-amber-300"
            }`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main content (needs useSearchParams — must be inside Suspense)
// ---------------------------------------------------------------------------

function IntakeCompletedContent() {
  const searchParams = useSearchParams();

  const redirectUrl = useMemo(
    () => resolveRedirectUrl(searchParams.get("redirect")),
    [searchParams],
  );

  const sessionCode = useMemo(
    () => (searchParams.get("code") || "").trim() || null,
    [searchParams],
  );

  const redirectSeconds = useMemo(
    () => Math.max(1, Math.ceil(AUTO_REDIRECT_MS / 1000)),
    [],
  );

  // "form"      — rating form visible (redirect paused)
  // "submitted" — patient submitted feedback
  // "skipped"   — patient skipped
  // "none"      — no session code present (existing behaviour)
  type FeedbackState = "form" | "submitted" | "skipped" | "none";
  const [feedbackState, setFeedbackState] = useState<FeedbackState>(
    sessionCode ? "form" : "none",
  );

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [secondsRemaining, setSecondsRemaining] = useState(redirectSeconds);

  // Countdown only runs once the feedback form is no longer visible
  const countdownActive = feedbackState !== "form";

  useEffect(() => {
    if (!countdownActive) return;

    const startTs = Date.now();
    const interval = window.setInterval(() => {
      const elapsedMs = Date.now() - startTs;
      const next = Math.max(0, Math.ceil((AUTO_REDIRECT_MS - elapsedMs) / 1000));
      setSecondsRemaining(next);
    }, 1000);

    const timeout = window.setTimeout(() => {
      window.location.replace(redirectUrl);
    }, AUTO_REDIRECT_MS);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [countdownActive, redirectUrl]);

  const handleSubmit = useCallback(async () => {
    if (!sessionCode || rating === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/sessions/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionCode, rating, comments }),
      });
      if (!res.ok && res.status !== 409) {
        // 409 = already submitted — treat as success on the frontend
        const body = await res.json().catch(() => ({}));
        setSubmitError(
          typeof body?.error === "string"
            ? body.error
            : "Could not submit feedback. Please try again.",
        );
        setSubmitting(false);
        return;
      }
      setFeedbackState("submitted");
    } catch {
      setSubmitError("Network error — please try again.");
      setSubmitting(false);
    }
  }, [sessionCode, rating, comments]);

  const handleSkip = useCallback(() => {
    setFeedbackState("skipped");
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4 pb-[40vh]">
      <main className="w-[80%] max-w-[calc(100vw-2rem)] sm:w-full sm:max-w-xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <Image
            src="/LogoFinal.png"
            alt="Health Assist AI logo"
            width={180}
            height={40}
          />
        </div>

        {/* Submission confirmation */}
        <h1 className="text-2xl font-semibold text-slate-900">Submission received</h1>
        <p className="mt-3 text-sm text-slate-700">
          Thank you. Your intake has been submitted to your physician.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          You will soon be contacted by your physician.
        </p>

        {/* ---------------------------------------------------------------- */}
        {/* Rating form — shown only when feedbackState === "form"           */}
        {/* ---------------------------------------------------------------- */}
        {feedbackState === "form" && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm font-semibold text-slate-800">Rate Your Experience</p>
            <p className="mt-1 text-xs text-slate-500">
              How was your experience with Health Assist AI?
            </p>

            <div className="mt-3">
              <StarRating
                value={rating}
                hovered={hoverRating}
                onRate={setRating}
                onHover={setHoverRating}
                onLeave={() => setHoverRating(0)}
              />
            </div>

            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value.slice(0, 2000))}
              placeholder="Comments or problems (optional)"
              rows={3}
              maxLength={2000}
              className="mt-3 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />

            {submitError && (
              <p className="mt-2 text-xs text-red-600">{submitError}</p>
            )}

            <div className="mt-4 flex items-center gap-4">
              <button
                type="button"
                disabled={submitting || rating === 0}
                onClick={handleSubmit}
                className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Submit Rating"}
              </button>
              <button
                type="button"
                onClick={handleSkip}
                className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* Thank-you message after submission */}
        {feedbackState === "submitted" && (
          <p className="mt-4 text-sm font-medium text-emerald-600">
            ✓ Thank you for your feedback!
          </p>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Privacy / close-tab message — shown after form is dismissed      */}
        {/* ---------------------------------------------------------------- */}
        {countdownActive && (
          <>
            <p className="mt-4 text-sm text-slate-700">
              For your privacy, please close this browser tab now.
            </p>
            <p className="mt-4 text-xs text-slate-500">
              This page auto-redirects in {secondsRemaining || redirectSeconds} seconds.
            </p>
            <button
              type="button"
              onClick={() => window.location.replace(redirectUrl)}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Continue
            </button>
          </>
        )}
      </main>
    </div>
  );
}

export default function IntakeCompletedPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4 pb-[40vh]">
          <main className="w-[80%] max-w-[calc(100vw-2rem)] sm:w-full sm:max-w-xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
            <div className="flex justify-center mb-6">
              <Image
                src="/LogoFinal.png"
                alt="Health Assist AI logo"
                width={180}
                height={40}
              />
            </div>
            <h1 className="text-2xl font-semibold text-slate-900">Submission received</h1>
            <p className="mt-3 text-sm text-slate-700">
              Thank you. Your intake has been submitted to your physician.
            </p>
            <p className="mt-2 text-sm text-slate-700">
              You will soon be contacted by your physician.
            </p>
            <p className="mt-2 text-sm text-slate-700">
              For your privacy, please close this browser tab now.
            </p>
          </main>
        </div>
      }
    >
      <IntakeCompletedContent />
    </Suspense>
  );
}
