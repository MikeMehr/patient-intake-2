"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client state for the "Transcribe" button in the OSCAR eChart.
 *
 * The flow: OSCAR's encounter window opens /launch/oscar?demographicNo=…, which
 * bounces same-origin to /physician/transcription?launch=oscar&demographicNo=…
 * (see src/app/launch/oscar/page.tsx for why the bounce is necessary). This
 * hook picks the parameters up, resolves the patient, and later hands the
 * finished SOAP note back to the OSCAR window via postMessage.
 *
 * Lives in its own module because the transcription page is ~2900 lines; the
 * page keeps only the wiring.
 */

export type OscarLaunchPatient = {
  id: string;
  fullName: string;
  dateOfBirth: string | null;
  email: string | null;
  primaryPhone: string | null;
};

export type OscarLaunchStatus =
  | "idle"
  | "resolving"
  | "resolved"
  | "not_found_in_oscar"
  | "oscar_not_connected"
  | "error";

export type SendFailureReason =
  | "no_opener"
  | "origin_not_allowed"
  | "empty"
  | "too_large"
  | "no_ack";

export type SendResult = { ok: true } | { ok: false; reason: SendFailureReason };

/** Matches the guard on the OSCAR side; keeps a runaway note out of postMessage. */
const MAX_NOTE_CHARS = 200_000;

/** How long to wait for the OSCAR page to confirm it inserted the note. */
const ACK_TIMEOUT_MS = 4000;

/** How often to re-check that the OSCAR window is still open. */
const OPENER_POLL_MS = 2000;

export const OSCAR_MESSAGE_TYPE = "healthassist.soap.insert";
export const OSCAR_ACK_TYPE = "healthassist.soap.ack";

function isOpenerAlive(): boolean {
  try {
    // `closed` is readable cross-origin; the property access itself can still
    // throw in exotic cases, hence the try.
    return Boolean(window.opener) && !window.opener.closed;
  } catch {
    return false;
  }
}

export function useOscarLaunch(options?: { onAuthFailure?: (res: Response) => boolean }) {
  const [launchMode, setLaunchMode] = useState(false);
  const [status, setStatus] = useState<OscarLaunchStatus>("idle");
  const [demographicNo, setDemographicNo] = useState<string | null>(null);
  const [patient, setPatient] = useState<OscarLaunchPatient | null>(null);
  const [openerOrigin, setOpenerOrigin] = useState<string | null>(null);
  const [openerAlive, setOpenerAlive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref so sendSoapToOscar never closes over a stale origin.
  const openerOriginRef = useRef<string | null>(null);
  const demographicNoRef = useRef<string | null>(null);
  const onAuthFailureRef = useRef(options?.onAuthFailure);
  onAuthFailureRef.current = options?.onAuthFailure;

  // ── Mount: read params, strip them, resolve the patient ──────────────────
  useEffect(() => {
    // Deliberately window.location.search rather than useSearchParams():
    // useSearchParams requires a <Suspense> boundary around the component or
    // the production build fails prerendering, and wrapping the very large
    // transcription page would change its mount timing (MediaRecorder,
    // sessionStorage effects) for no benefit — resolution is async anyway.
    const params = new URLSearchParams(window.location.search);
    if (params.get("launch") !== "oscar") return;

    const demo = params.get("demographicNo");
    const requestedOrigin = params.get("origin");
    setLaunchMode(true);
    setDemographicNo(demo);
    demographicNoRef.current = demo;
    setOpenerAlive(isOpenerAlive());

    // Drop the identifiers from the address bar, history, and any referrer we
    // might later send. Done after capturing them into state.
    try {
      window.history.replaceState({}, "", "/physician/transcription");
    } catch {
      /* non-fatal */
    }

    if (!demo) {
      // No usable patient id — the page falls back to manual entry.
      setStatus("not_found_in_oscar");
      return;
    }

    let cancelled = false;
    setStatus("resolving");
    (async () => {
      try {
        const res = await fetch("/api/physician/oscar-launch/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ demographicNo: demo, openerOrigin: requestedOrigin || undefined }),
        });
        if (cancelled) return;
        if (onAuthFailureRef.current?.(res)) return;
        if (!res.ok) {
          setStatus("error");
          setError("Could not load the patient from OSCAR.");
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        // The allowed origin comes ONLY from the server. The `origin` URL
        // param is advisory and is re-validated there against the allow-list.
        const allowed = typeof data.allowedOpenerOrigin === "string" ? data.allowedOpenerOrigin : null;
        setOpenerOrigin(allowed);
        openerOriginRef.current = allowed;

        if (data.status === "resolved" && data.patient?.id) {
          setPatient(data.patient as OscarLaunchPatient);
          setStatus("resolved");
        } else if (data.status === "oscar_not_connected") {
          setStatus("oscar_not_connected");
        } else {
          setStatus("not_found_in_oscar");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setError("Could not reach the server to load the patient.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Keep track of whether OSCAR is still there to receive the note ───────
  useEffect(() => {
    if (!launchMode) return;
    const tick = () => setOpenerAlive(isOpenerAlive());
    tick();
    const id = window.setInterval(tick, OPENER_POLL_MS);
    return () => window.clearInterval(id);
  }, [launchMode]);

  /**
   * Post the note to the OSCAR window and wait for it to confirm insertion.
   *
   * The ack matters: without it a note could be marked exported while the
   * OSCAR page had no listener (wrong page, script not installed, textarea
   * missing) and the text went nowhere.
   */
  const sendSoapToOscar = useCallback(async (text: string): Promise<SendResult> => {
    if (!isOpenerAlive()) return { ok: false, reason: "no_opener" };

    const targetOrigin = openerOriginRef.current;
    // Never postMessage PHI to "*". No allow-listed origin means no send.
    if (!targetOrigin) return { ok: false, reason: "origin_not_allowed" };

    const body = text.trim();
    if (!body) return { ok: false, reason: "empty" };
    if (body.length > MAX_NOTE_CHARS) return { ok: false, reason: "too_large" };

    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Math.random()).slice(2);

    return new Promise<SendResult>((resolve) => {
      let settled = false;
      let timer: number | undefined;

      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        if (timer !== undefined) window.clearTimeout(timer);
      };
      const settle = (result: SendResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      function onMessage(event: MessageEvent) {
        if (event.origin !== targetOrigin) return;
        const data = event.data as { type?: string; requestId?: string } | null;
        if (!data || data.type !== OSCAR_ACK_TYPE) return;
        if (data.requestId !== requestId) return;
        settle({ ok: true });
      }

      window.addEventListener("message", onMessage);
      timer = window.setTimeout(() => settle({ ok: false, reason: "no_ack" }), ACK_TIMEOUT_MS);

      try {
        window.opener.postMessage(
          {
            source: "healthassist",
            type: OSCAR_MESSAGE_TYPE,
            version: 1,
            requestId,
            // Echoed so the OSCAR side can refuse to paste into a chart the
            // physician has since navigated away from.
            demographicNo: demographicNoRef.current,
            text: body,
          },
          targetOrigin,
        );
      } catch {
        settle({ ok: false, reason: "no_opener" });
      }
    });
  }, []);

  /** Drop the OSCAR binding when the doctor says "not this patient". */
  const clearLaunchPatient = useCallback(() => {
    setPatient(null);
    setStatus("not_found_in_oscar");
  }, []);

  return {
    launchMode,
    status,
    demographicNo,
    patient,
    openerOrigin,
    openerAlive,
    error,
    sendSoapToOscar,
    clearLaunchPatient,
  };
}

/** Human-readable copy for a failed send. */
export function describeSendFailure(reason: SendFailureReason): string {
  switch (reason) {
    case "no_opener":
      return "The OSCAR window was closed. Use Copy SOAP and paste it into the encounter note.";
    case "origin_not_allowed":
      return "This OSCAR server is not approved to receive notes. Use Copy SOAP instead.";
    case "empty":
      return "There is no note text to send.";
    case "too_large":
      return "This note is too large to send automatically. Use Copy SOAP instead.";
    case "no_ack":
      return "OSCAR did not confirm the note was inserted. Nothing was saved — use Copy SOAP instead.";
  }
}
