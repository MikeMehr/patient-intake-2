# Security Dependency Audit Notes

## Date
2026-02-21

## Actions completed
- Upgraded `next` to `16.1.6` to remediate known Next.js DoS advisories affecting earlier `16.x` releases.
- Upgraded `jspdf` to `4.2.0` to remediate multiple high-severity jsPDF injection/DoS advisories.
- Updated `eslint-config-next` to align with upgraded Next.js toolchain.
- Re-ran runtime audit with `npm audit --omit=dev`.

## Remaining runtime vulnerabilities
- 5 high-severity findings remain in a transitive chain:
  - `@google-cloud/text-to-speech` -> `google-gax@5.0.6` -> `rimraf@5.0.10` -> `glob@10.5.0` -> `minimatch@9.0.6`
- This dependency line is currently pinned by upstream latest releases for `@google-cloud/text-to-speech` and `google-gax`.

## Risk acceptance context
- The remaining issues are not in application-auth or PHI route handlers directly.
- Exposure is limited to dependency internals used by Google client libraries.
- No safe upstream version is currently published for this chain in the project dependency graph.

## Follow-up
- Track upstream releases for `@google-cloud/text-to-speech` / `google-gax`.
- Remove this exception as soon as patched transitive versions are available.
