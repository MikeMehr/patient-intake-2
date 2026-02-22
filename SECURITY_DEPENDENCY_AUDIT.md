# Security Dependency Audit Notes

## Date
2026-02-22

## Actions completed
- Upgraded `next` to `16.1.6` to remediate known Next.js DoS advisories affecting earlier `16.x` releases.
- Upgraded `jspdf` to `4.2.0` to remediate multiple high-severity jsPDF injection/DoS advisories.
- Updated `eslint-config-next` to align with upgraded Next.js toolchain.
- Removed unused `@google-cloud/text-to-speech` dependency that introduced the remaining vulnerable transitive chain.
- Re-ran runtime audit with `npm audit --omit=dev --audit-level=high`.

## Remaining runtime vulnerabilities
- None.
- Runtime audit result: `found 0 vulnerabilities`.

## Risk acceptance context
- Previous temporary risk acceptance for the transitive minimatch chain is now superseded for runtime dependencies on this branch.
- If the risk acceptance artifact remains in-repo for recordkeeping, it should be marked closed/superseded at sign-off.

## Follow-up
- Keep CI launch gate enforcing `npm audit --omit=dev --audit-level=high`.
- Re-run runtime audit as part of every release candidate.
