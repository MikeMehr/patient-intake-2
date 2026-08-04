"use client";

/**
 * Where the OSCAR day-sheet 🎥 lands.
 *
 * Video runs on Doxy.me, which has no API and no per-visit rooms — one permanent waiting room per
 * provider, and the patient waits in it until admitted.
 *
 * Doxy has TWO addresses and they are not interchangeable. `doxy_room_url` is the PATIENT
 * check-in page (doxy.me/v2/check-in/<name>/) — the one to email, text, or put on the day sheet.
 * The provider signs in to their own dashboard, which is where checked-in patients appear and
 * where a call is actually started. Sending the provider to the patient link lands them on a
 * "please check in" form, which is exactly the wrong screen and precisely what this page did at
 * first.
 *
 * The path from OSCAR is unchanged (daysheet-video.js → /launch/oscar-video → here), which is why
 * the appointment number in the URL goes unused: the room belongs to the provider, not the
 * appointment, and the day sheet has no way to know which room that is.
 */

import { useCallback, useEffect, useState } from "react";

/**
 * Doxy's provider sign-in. Account-based rather than per-provider, so it is a constant rather
 * than another column: signing in lands the provider on their own dashboard, and an already
 * signed-in browser goes straight through.
 */
const DOXY_DASHBOARD_URL = "https://doxy.me/sign-in";

type RoomInfo = {
  doxyRoomUrl: string | null;
  physicianName: string | null;
  reason: "not_a_provider" | "no_room_set" | null;
};

export default function ProviderVideoPage() {
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/physician/video/room")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Could not load your video room.");
        return body as RoomInfo;
      })
      .then((d) => {
        if (!cancelled) setRoom(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = useCallback(async () => {
    if (!room?.doxyRoomUrl) return;
    await navigator.clipboard.writeText(room.doxyRoomUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [room]);

  if (error) {
    return (
      <Centered>
        <h1 className="text-lg font-semibold text-slate-900">Can&apos;t open your video room</h1>
        <p className="mt-2 text-slate-600">{error}</p>
      </Centered>
    );
  }

  if (!room) return <Centered>Loading your video room…</Centered>;

  // Say plainly what to do rather than showing an empty page. The likeliest reason anyone lands
  // here without a room is simply that nobody has filled the field in yet.
  if (!room.doxyRoomUrl) {
    return (
      <Centered>
        <h1 className="text-lg font-semibold text-slate-900">No video room set up yet</h1>
        <p className="mt-2 text-slate-600">
          {room.reason === "not_a_provider"
            ? "You're signed in as a clinic administrator, so there's no personal video room. Sign in as a provider to open one."
            : "Add your Doxy.me link to your provider record and this will work — Online Booking Dashboard → Providers → Edit."}
        </p>
      </Centered>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-5 py-10">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Video visit</h1>
        <p className="mt-1 text-sm text-slate-500">
          {room.physicianName ? `${room.physicianName} · ` : ""}
          Your patient waits in the room until you let them in.
        </p>

        <a
          href={DOXY_DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 block w-full rounded-lg bg-blue-600 px-6 py-3 text-center font-medium text-white hover:bg-blue-700"
        >
          Open my Doxy dashboard
        </a>
        <p className="mt-2 text-xs text-slate-500">
          Your waiting room, where checked-in patients appear and you start the call.
        </p>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <p className="text-sm font-medium text-slate-700">Patient check-in link</p>
          <p className="mt-1 break-all rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
            {room.doxyRoomUrl}
          </p>
          <button onClick={copy} className="mt-2 text-sm font-medium text-blue-600 hover:underline">
            {copied ? "Copied" : "Copy link"}
          </button>
          <p className="mt-3 text-xs text-slate-500">
            Send this to the patient, not to yourself — it opens the check-in form. The same link
            every time, and anyone who booked a video visit already has it. To text or email it,
            use{" "}
            <a href="/org/video-invite" className="text-blue-600 hover:underline">
              Invite to Video Call
            </a>
            .
          </p>
        </div>
      </div>
    </main>
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
