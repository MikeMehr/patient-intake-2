"use client";

import { useEffect } from "react";

/**
 * SameSite=Strict bounce page for the OSCAR eChart "Transcribe" button.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * `physician_session` is SameSite=Strict (src/lib/auth.ts). When OSCAR at
 * oscar.mymdonline.ca does window.open() to physician.health-assist.org, that
 * is a CROSS-SITE top-level navigation, so the browser withholds the session
 * cookie on the very first document request — before any of our JS runs — and
 * src/proxy.ts bounces the popup to /auth/login even for a logged-in doctor.
 *
 * This page is public (no session needed) and immediately performs a
 * CLIENT-SIDE navigation to the real destination. That second navigation is
 * same-origin → same-site → the Strict cookie IS sent, and the transcription
 * page loads authenticated.
 *
 * THREE THINGS THAT MUST NOT CHANGE:
 *   1. The second hop must be client-side. A server-side redirect keeps
 *      oscar.mymdonline.ca as the initiator of the whole chain, so the cookie
 *      would still be withheld and this page would do nothing.
 *   2. `location.replace` (not `assign`) so the popup's Back button doesn't
 *      land the doctor on this blank interstitial.
 *   3. window.opener survives same-origin navigation, which is what lets the
 *      finished note be posted back to OSCAR. Never add a
 *      Cross-Origin-Opener-Policy header (guarded in security-regressions.test.ts),
 *      and the OSCAR side must not pass "noopener" to window.open.
 *
 * SECURITY: the destination path is a hard-coded constant. Only individually
 * validated parameters are appended, so no attacker-supplied string can reach
 * the path or host — there is no open-redirect surface here.
 */

const DESTINATION_PATH = "/physician/transcription";

/** OSCAR demographic numbers are small positive integers. */
const DEMOGRAPHIC_NO_RE = /^[0-9]{1,12}$/;

/**
 * Shape check only. The authoritative allow-list lives server-side in
 * src/lib/oscar/launch-origins.ts — this value is advisory and is re-validated
 * there before the browser is ever told which origin it may post PHI to.
 */
const ORIGIN_SHAPE_RE = /^https?:\/\/[a-z0-9.-]{1,253}(:[0-9]{1,5})?$/i;

function buildDestination(search: string): string {
  const incoming = new URLSearchParams(search);
  const out = new URLSearchParams();
  out.set("launch", "oscar");

  const demographicNo = incoming.get("demographicNo") ?? "";
  if (DEMOGRAPHIC_NO_RE.test(demographicNo)) {
    out.set("demographicNo", demographicNo);
  }
  // A malformed demographicNo is dropped rather than treated as an error: the
  // transcription page simply falls back to manual patient entry, and the
  // doctor can still dictate.

  const origin = incoming.get("origin") ?? "";
  if (origin.length <= 253 && ORIGIN_SHAPE_RE.test(origin)) {
    out.set("origin", origin);
  }

  return `${DESTINATION_PATH}?${out.toString()}`;
}

export default function OscarLaunchPage() {
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
        <p className="text-sm text-slate-600">Opening Health Assist…</p>
        <noscript>
          <p className="mt-3 text-sm text-slate-600">
            JavaScript is required.{" "}
            <a className="underline" href={DESTINATION_PATH}>
              Continue to transcription
            </a>
          </p>
        </noscript>
      </div>
    </main>
  );
}
