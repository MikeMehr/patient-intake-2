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
