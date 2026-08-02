"use client";

/**
 * The patient's side of a video visit.
 *
 * Public and token-gated: the URL is the credential, so nothing here is behind a login. The
 * page deliberately does two round trips — a validation fetch that returns no credential, and
 * a join POST that returns the room only inside the join window. That means an early or stale
 * link shows a countdown rather than opening a room.
 *
 * The waiting room is not decoration. A patient who discovers at 10:00 that their browser
 * never had camera permission has already missed the appointment, so the device check runs
 * while they wait.
 */

import { use, useCallback, useEffect, useRef, useState } from "react";
import type DailyIframe from "@daily-co/daily-js";

type VisitState = "open" | "too_early" | "ended" | "cancelled" | "not_found";

type VisitInfo = {
  state: VisitState;
  clinicName: string | null;
  physicianName: string | null;
  patientFirstName: string | null;
  scheduledStartAt: string | null;
  joinOpensAt: string | null;
  providerPresent: boolean;
};

type DeviceCheck = "idle" | "checking" | "ok" | "denied" | "unavailable";

const POLL_MS = 4000;

export default function VideoVisitPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [info, setInfo] = useState<VisitInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [inCall, setInCall] = useState(false);
  const [deviceCheck, setDeviceCheck] = useState<DeviceCheck>("idle");

  const frameRef = useRef<HTMLDivElement | null>(null);
  const callRef = useRef<ReturnType<typeof DailyIframe.createFrame> | null>(null);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/visit/${token}`)
      .then((r) => r.json())
      .then((data: VisitInfo) => {
        if (cancelled) return;
        setInfo(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setInfo({
          state: "not_found",
          clinicName: null,
          physicianName: null,
          patientFirstName: null,
          scheduledStartAt: null,
          joinOpensAt: null,
          providerPresent: false,
        });
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // ── Presence poll ─────────────────────────────────────────────────────────
  // Also the patient's own heartbeat, which is what tells the provider console someone is
  // waiting. Keeps running during the call so the "your doctor is here" state stays honest if
  // the provider drops.
  useEffect(() => {
    if (!info || info.state === "not_found" || info.state === "cancelled") return;
    const tick = async () => {
      try {
        const res = await fetch(`/api/visit/${token}/status`);
        const data = await res.json();
        setInfo((prev) =>
          prev ? { ...prev, state: data.state ?? prev.state, providerPresent: !!data.providerPresent } : prev,
        );
      } catch {
        // A dropped poll is not worth surfacing — the next one is 4 seconds away.
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [token, info?.state]);

  // ── Tear the call down on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      callRef.current?.destroy();
      callRef.current = null;
    };
  }, []);

  const runDeviceCheck = useCallback(async () => {
    setDeviceCheck("checking");
    if (!navigator.mediaDevices?.getUserMedia) {
      setDeviceCheck("unavailable");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      // Release immediately — holding the camera would leave the light on through the wait.
      stream.getTracks().forEach((t) => t.stop());
      setDeviceCheck("ok");
    } catch {
      setDeviceCheck("denied");
    }
  }, []);

  const join = useCallback(async () => {
    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/visit/${token}/join`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setJoinError(
          body.error === "not_open"
            ? "This visit isn't open yet. The page will update when it is."
            : "We couldn't connect you to the video call. Please try again.",
        );
        setJoining(false);
        return;
      }
      const { roomUrl, meetingToken, userName } = await res.json();

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
      await frame.join({ url: roomUrl, token: meetingToken, userName });
      setInCall(true);
    } catch {
      setJoinError("We couldn't start the video call. Please try again.");
    } finally {
      setJoining(false);
    }
  }, [token]);

  if (loading) {
    return <Shell><p className="text-slate-500">Loading your appointment…</p></Shell>;
  }

  if (!info || info.state === "not_found") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-slate-900">Link not found</h1>
        <p className="mt-2 text-slate-600">
          This video visit link is no longer valid. It may have expired, or the appointment may
          have been cancelled. Please contact the clinic if you were expecting an appointment.
        </p>
      </Shell>
    );
  }

  if (info.state === "cancelled") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-slate-900">Appointment cancelled</h1>
        <p className="mt-2 text-slate-600">
          This appointment was cancelled. Please contact {info.clinicName ?? "the clinic"} if you
          need to rebook.
        </p>
      </Shell>
    );
  }

  if (info.state === "ended") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-slate-900">This visit has ended</h1>
        <p className="mt-2 text-slate-600">
          The video call for this appointment is closed. Please contact{" "}
          {info.clinicName ?? "the clinic"} if you still need to be seen.
        </p>
      </Shell>
    );
  }

  // In-call: the Daily frame owns the viewport.
  if (inCall) {
    return (
      <div className="flex h-dvh w-full flex-col bg-slate-900">
        <div ref={frameRef} className="flex-1" />
      </div>
    );
  }

  return (
    <Shell>
      {/* Mounted but hidden so the ref exists the moment join() resolves. */}
      <div ref={frameRef} className="hidden" />

      <h1 className="text-xl font-semibold text-slate-900">
        {info.patientFirstName ? `Hello ${info.patientFirstName} — ` : ""}
        video appointment
      </h1>
      <p className="mt-1 text-slate-600">
        {info.physicianName ?? "Your physician"}
        {info.clinicName ? ` · ${info.clinicName}` : ""}
      </p>

      {info.scheduledStartAt && (
        <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-slate-800">
          {new Intl.DateTimeFormat(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(info.scheduledStartAt))}
        </p>
      )}

      {info.state === "too_early" ? (
        <div className="mt-6">
          <p className="text-slate-700">
            You can join 15 minutes before your appointment. This page will update on its own —
            you can leave it open.
          </p>
          {info.joinOpensAt && <Countdown target={info.joinOpensAt} />}
        </div>
      ) : (
        <div className="mt-6">
          <p className="text-slate-700">
            {info.providerPresent
              ? `${info.physicianName ?? "Your physician"} is in the room and ready for you.`
              : "You can join now. Your physician will be with you shortly."}
          </p>
          <button
            onClick={join}
            disabled={joining}
            className="mt-4 w-full rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {joining ? "Connecting…" : "Join video call"}
          </button>
          {joinError && <p className="mt-3 text-sm text-red-600">{joinError}</p>}
        </div>
      )}

      <DeviceCheckPanel state={deviceCheck} onRun={runDeviceCheck} />

      {/* In-app browsers (Gmail, Instagram, Facebook) routinely fail getUserMedia with no
          useful error, and the patient has no way to know that's what happened. */}
      <p className="mt-6 text-xs text-slate-500">
        If the video doesn&apos;t start, open this link in Safari or Chrome rather than inside
        another app.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-10">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
}

function DeviceCheckPanel({ state, onRun }: { state: DeviceCheck; onRun: () => void }) {
  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      {state === "ok" ? (
        <p className="text-sm text-green-700">✓ Your camera and microphone are working.</p>
      ) : state === "denied" ? (
        <p className="text-sm text-amber-700">
          Your browser blocked the camera or microphone. Allow access in the address bar, then
          test again.
        </p>
      ) : state === "unavailable" ? (
        <p className="text-sm text-amber-700">
          This browser can&apos;t use the camera. Please open the link in Safari or Chrome.
        </p>
      ) : (
        <button
          onClick={onRun}
          disabled={state === "checking"}
          className="text-sm font-medium text-blue-600 hover:underline disabled:opacity-60"
        >
          {state === "checking" ? "Testing…" : "Test your camera and microphone"}
        </button>
      )}
    </div>
  );
}

function Countdown({ target }: { target: string }) {
  const [remaining, setRemaining] = useState(() => msUntil(target));
  useEffect(() => {
    const id = setInterval(() => setRemaining(msUntil(target)), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (remaining <= 0) return null;
  const total = Math.floor(remaining / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const label = h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, "0")}s`;
  return <p className="mt-3 text-2xl font-semibold tabular-nums text-slate-900">{label}</p>;
}

function msUntil(iso: string): number {
  return new Date(iso).getTime() - Date.now();
}
