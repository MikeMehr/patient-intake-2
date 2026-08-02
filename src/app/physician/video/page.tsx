"use client";

/**
 * The provider's video console.
 *
 * Reached from the OSCAR day sheet via /launch/oscar-video, which bounces here so the
 * SameSite=Strict session cookie re-attaches on a same-origin navigation. Guarded twice before
 * this component runs: the proxy checks the cookie shape, and src/app/physician/layout.tsx
 * verifies the session against the database.
 *
 * The page itself holds nothing sensitive — everything comes from POST
 * /api/physician/video/session, which resolves the appointment inside the caller's own
 * organization.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type DailyIframe from "@daily-co/daily-js";

type SessionInfo = {
  visitId: string;
  roomUrl: string;
  meetingToken: string;
  patientJoinUrl: string | null;
  patientName: string | null;
  scheduledStartAt: string | null;
  patientPresent: boolean;
  suggestedEmail: string | null;
  suggestedPhone: string | null;
};

const HEARTBEAT_MS = 4000;

export default function ProviderVideoPage() {
  return (
    <Suspense fallback={<Centered>Loading…</Centered>}>
      <ProviderVideoConsole />
    </Suspense>
  );
}

function ProviderVideoConsole() {
  const searchParams = useSearchParams();
  const oscarApptNo = searchParams.get("oscarApptNo");
  const appointmentId = searchParams.get("appointmentId");
  const demographicNo = searchParams.get("demographicNo");

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [patientPresent, setPatientPresent] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [copied, setCopied] = useState(false);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const callRef = useRef<ReturnType<typeof DailyIframe.createFrame> | null>(null);

  // ── Resolve (or create) the visit ─────────────────────────────────────────
  useEffect(() => {
    if (!oscarApptNo && !appointmentId) {
      setError("No appointment was specified.");
      return;
    }
    let cancelled = false;
    fetch("/api/physician/video/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oscarApptNo, appointmentId, demographicNo }),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Could not open the video room.");
        return body as SessionInfo;
      })
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        setPatientPresent(data.patientPresent);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [oscarApptNo, appointmentId, demographicNo]);

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  // Tells the patient's waiting room that the provider is here, and reads back whether the
  // patient is. Freshness is the signal on both sides — see touchPresence().
  useEffect(() => {
    if (!session) return;
    const tick = async () => {
      try {
        const res = await fetch(`/api/physician/video/${session.visitId}/heartbeat`, {
          method: "POST",
        });
        if (!res.ok) return;
        const data = await res.json();
        setPatientPresent(!!data.patientPresent);
      } catch {
        // Transient — the next beat is 4 seconds away.
      }
    };
    void tick();
    const id = setInterval(tick, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    return () => {
      callRef.current?.destroy();
      callRef.current = null;
    };
  }, []);

  const join = useCallback(async () => {
    if (!session) return;
    try {
      const { default: Daily } = await import("@daily-co/daily-js");
      const frame = Daily.createFrame(frameRef.current!, {
        showLeaveButton: true,
        iframeStyle: { width: "100%", height: "100%", border: "0" },
      });
      callRef.current = frame;
      frame.on("left-meeting", () => {
        setInCall(false);
        callRef.current?.destroy();
        callRef.current = null;
      });
      await frame.join({ url: session.roomUrl, token: session.meetingToken });
      setInCall(true);
    } catch {
      setError("Could not start the video call.");
    }
  }, [session]);

  const copyLink = useCallback(async () => {
    if (!session?.patientJoinUrl) return;
    await navigator.clipboard.writeText(session.patientJoinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [session]);

  if (error) {
    return (
      <Centered>
        <h1 className="text-lg font-semibold text-slate-900">Can&apos;t open this visit</h1>
        <p className="mt-2 text-slate-600">{error}</p>
      </Centered>
    );
  }

  if (!session) return <Centered>Opening the video room…</Centered>;

  if (inCall) {
    return (
      <div className="flex h-dvh w-full flex-col bg-slate-900">
        <div ref={frameRef} className="flex-1" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-5 py-10">
      <div ref={frameRef} className="hidden" />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          {session.patientName ?? "Video visit"}
        </h1>
        {session.scheduledStartAt && (
          <p className="mt-1 text-slate-600">
            {new Intl.DateTimeFormat(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(session.scheduledStartAt))}
          </p>
        )}

        <p
          className={`mt-5 rounded-lg px-4 py-3 text-sm font-medium ${
            patientPresent ? "bg-green-50 text-green-800" : "bg-slate-50 text-slate-600"
          }`}
        >
          {patientPresent ? "● Patient is waiting" : "○ Patient hasn't joined yet"}
        </p>

        <button
          onClick={join}
          className="mt-5 w-full rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
        >
          Start video visit
        </button>

        {session.patientJoinUrl ? (
          <SendLinkPanel
            visitId={session.visitId}
            joinUrl={session.patientJoinUrl}
            suggestedEmail={session.suggestedEmail}
            suggestedPhone={session.suggestedPhone}
            onCopy={copyLink}
            copied={copied}
          />
        ) : (
          <p className="mt-6 border-t border-slate-200 pt-5 text-sm text-slate-500">
            This visit predates re-sendable links, so a new one can&apos;t be generated. The
            patient&apos;s original link still works.
          </p>
        )}
      </div>
    </main>
  );
}

/**
 * Send the patient their link.
 *
 * The destination is prefilled from the chart but always editable and always confirmed — a
 * mistyped address here mails a live join credential to a stranger, so nothing is sent on a
 * value the provider hasn't looked at.
 */
function SendLinkPanel({
  visitId,
  joinUrl,
  suggestedEmail,
  suggestedPhone,
  onCopy,
  copied,
}: {
  visitId: string;
  joinUrl: string;
  suggestedEmail: string | null;
  suggestedPhone: string | null;
  onCopy: () => void;
  copied: boolean;
}) {
  const [channel, setChannel] = useState<"sms" | "email">(
    suggestedPhone ? "sms" : "email",
  );
  const [destination, setDestination] = useState(suggestedPhone ?? suggestedEmail ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<
    { kind: "sent" } | { kind: "suppressed"; message: string } | { kind: "error"; message: string } | null
  >(null);

  function pickChannel(next: "sms" | "email") {
    setChannel(next);
    setResult(null);
    setDestination(next === "sms" ? (suggestedPhone ?? "") : (suggestedEmail ?? ""));
  }

  async function send() {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/physician/video/${visitId}/send-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, destination }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.sent) {
        setResult({ kind: "sent" });
      } else if (body.reason === "suppressed") {
        setResult({ kind: "suppressed", message: body.message });
      } else {
        setResult({ kind: "error", message: body.error ?? "The message could not be sent." });
      }
    } catch {
      setResult({ kind: "error", message: "The message could not be sent." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <p className="text-sm font-medium text-slate-700">Send the patient their link</p>

      <div className="mt-3 flex gap-2">
        {(["sms", "email"] as const).map((c) => (
          <button
            key={c}
            onClick={() => pickChannel(c)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              channel === c
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {c === "sms" ? "Text" : "Email"}
          </button>
        ))}
      </div>

      <input
        value={destination}
        onChange={(e) => {
          setDestination(e.target.value);
          setResult(null);
        }}
        placeholder={channel === "sms" ? "604 555 0123" : "patient@example.com"}
        inputMode={channel === "sms" ? "tel" : "email"}
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
      />

      <button
        onClick={send}
        disabled={sending || !destination.trim()}
        className="mt-3 w-full rounded-lg bg-slate-800 px-4 py-2.5 font-medium text-white hover:bg-slate-900 disabled:opacity-50"
      >
        {sending ? "Sending…" : channel === "sms" ? "Text the link" : "Email the link"}
      </button>

      {result?.kind === "sent" && (
        <p className="mt-2 text-sm text-green-700">✓ Sent.</p>
      )}
      {result?.kind === "error" && (
        <p className="mt-2 text-sm text-red-600">{result.message}</p>
      )}
      {/* The case that would otherwise fail silently: messaging is off, so the provider has to
          read the link out. Showing it is the whole point of distinguishing this outcome. */}
      {result?.kind === "suppressed" && (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2">
          <p className="text-sm text-amber-800">{result.message}</p>
          <p className="mt-1 break-all font-mono text-xs text-amber-900">{joinUrl}</p>
        </div>
      )}

      <div className="mt-4">
        <button onClick={onCopy} className="text-sm font-medium text-blue-600 hover:underline">
          {copied ? "Copied" : "Copy link instead"}
        </button>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
        {children}
      </div>
    </main>
  );
}
