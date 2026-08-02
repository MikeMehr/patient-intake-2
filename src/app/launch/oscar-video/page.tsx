"use client";

import { useEffect } from "react";

/**
 * SameSite=Strict bounce page for the OSCAR day-sheet video button.
 *
 * A sibling of /launch/oscar, and it exists for exactly the same reason: OSCAR at
 * oscar.mymdonline.ca opens this cross-site, so the browser withholds the
 * `physician_session` cookie on the first document request and src/proxy.ts would bounce a
 * logged-in doctor to /auth/login. This page is public and immediately does a CLIENT-SIDE
 * navigation to /physician/video, which is same-origin and therefore carries the cookie.
 *
 * WHY THIS IS A SEPARATE FILE rather than a `destination` parameter on /launch/oscar:
 * that page's whole security argument is that DESTINATION_PATH is a hard-coded literal with no
 * attacker-reachable component. Parameterising it would turn a page anyone can open cross-site
 * into an open redirect out of an authenticated clinical session. Duplicating twenty lines is
 * the cheaper trade.
 *
 * TWO THINGS THAT MUST NOT CHANGE (the third invariant of /launch/oscar does not apply here):
 *   1. The second hop must be client-side. A server-side redirect keeps OSCAR as the initiator
 *      of the chain, so the cookie stays withheld and this page accomplishes nothing.
 *   2. `location.replace`, not `assign`, so the popup's Back button doesn't strand the doctor
 *      on this interstitial.
 *
 * Unlike the transcription launch, this flow has NO postMessage return channel — nothing is
 * sent back to OSCAR. So window.opener is not needed, and the OSCAR side deliberately DOES pass
 * "noopener". Do not "make the two consistent" in either direction.
 */

const DESTINATION_PATH = "/physician/video";

/** OSCAR appointment and demographic numbers are small positive integers. */
const NUMERIC_ID_RE = /^[0-9]{1,12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildDestination(search: string): string {
  const incoming = new URLSearchParams(search);
  const out = new URLSearchParams();

  const apptNo = incoming.get("oscarApptNo") ?? "";
  if (NUMERIC_ID_RE.test(apptNo)) out.set("oscarApptNo", apptNo);

  // Our own appointment id, used by the link written into OSCAR's notes field at booking time —
  // at that moment the OSCAR appointment number doesn't exist yet, and OSCAR publishes no way to
  // add it to the note afterwards. Not a credential: the console still resolves it inside the
  // caller's organization and still requires a physician session.
  const appointmentId = incoming.get("appointmentId") ?? "";
  if (UUID_RE.test(appointmentId)) out.set("appointmentId", appointmentId);

  // Carried so the console can prefill a send-link destination from the chart when the
  // appointment has no row of ours. Dropped silently if malformed — the provider can still
  // type an address.
  const demographicNo = incoming.get("demographicNo") ?? "";
  if (NUMERIC_ID_RE.test(demographicNo)) out.set("demographicNo", demographicNo);

  const qs = out.toString();
  return qs ? `${DESTINATION_PATH}?${qs}` : DESTINATION_PATH;
}

export default function OscarVideoLaunchPage() {
  useEffect(() => {
    window.location.replace(buildDestination(window.location.search));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="text-center">
        <div
          className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
          aria-hidden="true"
        />
        <p className="text-sm text-slate-600">Opening the video visit…</p>
        <noscript>
          <p className="mt-3 text-sm text-slate-600">
            JavaScript is required.{" "}
            <a className="underline" href={DESTINATION_PATH}>
              Continue to the video console
            </a>
          </p>
        </noscript>
      </div>
    </main>
  );
}
