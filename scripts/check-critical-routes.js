/**
 * Pre-build guard: verifies that critical API routes exist before `next build` runs.
 *
 * These routes have been accidentally deleted three times by large unrelated commits
 * (fa2282d, 5694194, and once more). Running this as a `prebuild` npm script means
 * `npm run build` — and therefore every CI deploy — fails immediately with a clear
 * message before any expensive build work begins.
 *
 * To add a new protected route, append its path to the CRITICAL_ROUTES array.
 */

const fs = require("fs");
const path = require("path");

const CRITICAL_ROUTES = [
  "src/app/api/sessions/feedback/route.ts",
  "src/app/api/admin/feedback/route.ts",
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
