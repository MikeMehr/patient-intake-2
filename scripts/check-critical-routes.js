/**
 * Pre-build guard: verifies that critical API routes exist before `next build` runs.
 *
 * These routes have been accidentally deleted three times by large unrelated commits
 * (fa2282d, 5694194, and once more). It runs as the `prebuild` npm script and as an
 * explicit step in .github/workflows/main_healt-assist-ai-prod.yml — the workflow calls
 * `npx next build` directly, which does NOT fire npm lifecycle hooks, so without that
 * step this guard would never run on the one path that matters. Keep both.
 *
 * WHEN A ROUTE IS INTENTIONALLY REMOVED, DELETE ITS LINE HERE IN THE SAME COMMIT.
 * A stale entry fails every build forever, which trains people to bypass the guard —
 * exactly what happened to the Daily.co entries between 2026-08-03 and 2026-08-08.
 *
 * To add a new protected route, append its path to the CRITICAL_ROUTES array.
 */

const fs = require("fs");
const path = require("path");

/**
 * The bar for this list: losing the route breaks a patient- or provider-facing flow with no
 * alternative route to the same outcome. Routes that merely degrade do NOT belong here — a
 * list that names everything is a directory listing and stops carrying signal.
 */
const CRITICAL_ROUTES = [
  "src/app/api/sessions/feedback/route.ts",
  "src/app/api/admin/feedback/route.ts",

  // Video visits, post-Daily.co. Doxy has no API and no per-visit rooms, so the whole
  // surface is these two: the provider asks which waiting room is theirs (reached from the
  // OSCAR day sheet via /launch/oscar-video, where the session is the only identity we
  // have), and the clinic sends a patient a link with no booking attached. Neither has a
  // fallback path if the route silently disappears — the original reason for guarding the
  // three Daily routes these replaced.
  "src/app/api/physician/video/room/route.ts",
  "src/app/api/org/video-invite/route.ts",

  // Online booking. Every one of these hard-fails the patient rather than degrading:
  //   info    — nothing renders, there is no clinic to book with
  //   slots   — no times to choose
  //   hold    — confirm rejects a booking with no live hold ("No active hold found")
  //   lookup-patient      — a non-OK response sets step="blocked" and the patient stops
  //   create-oscar-patient— the not-found branch; a non-OK response aborts every
  //                         first-time patient's booking before confirm is ever called
  //   confirm — the booking itself
  // The clinic's phone number is the only fallback, which is the exact cost this system
  // exists to remove.
  "src/app/api/booking/[clinicSlug]/info/route.ts",
  "src/app/api/booking/[clinicSlug]/slots/route.ts",
  "src/app/api/booking/[clinicSlug]/hold/route.ts",
  "src/app/api/booking/[clinicSlug]/lookup-patient/route.ts",
  "src/app/api/booking/[clinicSlug]/create-oscar-patient/route.ts",
  "src/app/api/booking/[clinicSlug]/confirm/route.ts",

  // Reached only from the confirmation email, so a patient who loses these has no route to
  // their own booking at all. cancel is separate from manage and is the one that keeps
  // no-shows off the day sheet.
  "src/app/api/booking/manage/[token]/route.ts",
  "src/app/api/booking/manage/[token]/cancel/route.ts",

  // Deliberately NOT guarded, so their absence here reads as a decision rather than an
  // oversight:
  //   booking/clinics       — the index page only; the advertised /booking/<slug> links,
  //                           which is how patients actually arrive, keep working
  //   pharmacy-search       — typeahead; confirm persists the pharmacy choice in the same
  //                           statement that creates the booking, so a bridge outage still
  //                           leaves staff a row to reconcile
  //   report-issue          — the outage reporter, not part of the booking flow
];

const root = path.resolve(__dirname, "..");
let missing = 0;

for (const route of CRITICAL_ROUTES) {
  const full = path.join(root, route);
  if (!fs.existsSync(full)) {
    console.error(`\n  ✗ Missing critical route: ${route}`);
    missing++;
  }
}

if (missing > 0) {
  console.error(
    `\n${missing} critical API route(s) are missing from the repository.` +
    `\nRestore them before running the build.\n`
  );
  process.exit(1);
}

console.log("  ✓ All critical routes present — proceeding with build.");
