"use client";

/**
 * Send a patient the provider's Doxy waiting-room link.
 *
 * For a call with no appointment behind it — a patient phones in, or a follow-up needs five
 * minutes of face time. Since video moved to Doxy there is nothing to create: one permanent room
 * per provider, so this looks the link up and sends it.
 *
 * Deliberately one screen and one action. Staff doing this are usually mid-phone-call with the
 * patient on the line.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Result = {
  joinUrl: string;
  sent: boolean;
  suppressed: boolean;
  error: string | null;
};

type Channel = "sms" | "email";

type Provider = {
  id: string;
  firstName: string;
  lastName: string;
  doxyRoomUrl: string | null;
};

export default function VideoInvitePage() {
  const router = useRouter();

  // Whose room is being sent. This page lives under /org, where the signed-in user is usually a
  // clinic administrator with no room of their own — so the provider has to be chosen, not
  // inferred. Without this the API rightly refused and there was no way to satisfy it.
  const [providers, setProviders] = useState<Provider[]>([]);
  const [physicianId, setPhysicianId] = useState("");

  const [patientName, setPatientName] = useState("");
  const [channel, setChannel] = useState<Channel>("sms");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/org/providers")
      .then((r) => r.json())
      .then((d) => {
        const list: Provider[] = d.providers ?? [];
        setProviders(list);
        // Preselect when there is no choice to make — including the common case where only one
        // provider has a room set up.
        const withRoom = list.filter((p) => p.doxyRoomUrl);
        if (withRoom.length === 1) setPhysicianId(withRoom[0].id);
      })
      .catch(() => {});
  }, []);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/video-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientName, channel, destination, physicianId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not create the invite.");
        return;
      }
      setResult(body as Result);
    } catch {
      setError("Could not create the invite.");
    } finally {
      setBusy(false);
    }
  }, [patientName, channel, destination, physicianId]);

  const copy = useCallback(async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  const selected = providers.find((p) => p.id === physicianId);
  const canSubmit = !busy && destination.trim().length > 0 && !!selected?.doxyRoomUrl;

  return (
    <main className="mx-auto max-w-lg px-5 py-10">
      <button onClick={() => router.push("/org/dashboard")} className="mb-4 text-sm text-blue-600">
        ← Dashboard
      </button>
      <h1 className="text-2xl font-bold text-gray-900">Invite a patient to a video call</h1>
      <p className="mt-1 text-sm text-gray-500">
        For a call with no booking behind it. Sends the patient your Doxy waiting-room link — they
        open it, enter their name, and wait for you to let them in.
      </p>

      {!result ? (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium text-gray-700">Whose waiting room?</label>
          <select
            value={physicianId}
            onChange={(e) => {
              setPhysicianId(e.target.value);
              setError(null);
            }}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Choose a provider…</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.doxyRoomUrl}>
                Dr. {p.firstName} {p.lastName}
                {p.doxyRoomUrl ? "" : " — no Doxy link set"}
              </option>
            ))}
          </select>
          {physicianId && !selected?.doxyRoomUrl && (
            <p className="mt-1 text-xs text-amber-700">
              That provider has no Doxy link yet. Add it on their provider record first.
            </p>
          )}

          <label className="mt-5 block text-sm font-medium text-gray-700">Patient name</label>
          <input
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Optional — shown on your screen during the call"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />

          <p className="mt-5 text-sm font-medium text-gray-700">How should they get the link?</p>
          <div className="mt-2 flex gap-2">
            {([
              ["sms", "Text"],
              ["email", "Email"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setChannel(value);
                  setError(null);
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  channel === value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={channel === "sms" ? "604 555 0123" : "patient@example.com"}
            inputMode={channel === "sms" ? "tel" : "email"}
            className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />

          <button
            onClick={create}
            disabled={!canSubmit}
            className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Sending…" : channel === "sms" ? "Text the link" : "Email the link"}
          </button>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <p className="mt-4 text-xs text-gray-400">
            The same link every time — it's your permanent waiting room, so it doesn't expire.
          </p>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {result.sent && <p className="text-sm font-medium text-green-700">✓ Link sent.</p>}
          {/* Suppression is called out rather than swallowed: the senders return quietly when
              HIPAA_MODE is on, and a staff member who thinks a text went out will not follow up. */}
          {result.suppressed && (
            <p className="text-sm text-amber-700">
              Messaging is switched off on this deployment — read the link to the patient instead.
            </p>
          )}
          {result.error && <p className="text-sm text-red-600">{result.error}</p>}

          <p className="mt-4 text-sm font-medium text-gray-700">Patient link</p>
          <p className="mt-1 break-all rounded bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600">
            {result.joinUrl}
          </p>
          <button onClick={copy} className="mt-2 text-sm font-medium text-blue-600 hover:underline">
            {copied ? "Copied" : "Copy link"}
          </button>

          <a
            href={result.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 block w-full rounded-lg bg-blue-600 px-4 py-2.5 text-center font-medium text-white hover:bg-blue-700"
          >
            Open the waiting room
          </a>
          <button
            onClick={() => {
              setResult(null);
              setDestination("");
              setPatientName("");
            }}
            className="mt-3 w-full text-sm text-gray-500 hover:text-gray-700"
          >
            Send to someone else
          </button>
        </div>
      )}
    </main>
  );
}
