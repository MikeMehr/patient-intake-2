# Technical Safeguards

## Authentication and Session Controls

- Session cookies use secure attributes (`httpOnly`, `sameSite`, TLS-aware `secure`).
- Server-side sessions are invalidated on logout and credential reset.
- Idle timeout and absolute session lifetime are enforced.
- Session token rotates on successful idle-refresh keepalive.
- Concurrent workforce sessions are capped per account with oldest-first eviction.
- Admin session termination APIs support per-user and scoped/global revocation workflows.
- Auth endpoint abuse controls use durable rate limiting:
  - login
  - registration
  - reset password request
  - reset password consume

## Authorization and Access Control

- Workforce role enforcement applies to PHI routes.
- Organization-scoped access checks prevent cross-org PHI access.
- Legacy same-provider fallback behavior is restricted and tested.
- Sensitive endpoints return:
  - `401` when unauthenticated
  - `403` for unauthorized scope
  - success only for authorized in-scope users

## PHI Audit Logging

- PHI access events are logged for successful reads/writes/deletes/exports.
- Logs include actor, target, action, time, and request metadata.
- Logging avoids PHI payload leakage in debug or error paths.

## Token and Secret Handling

- Reset tokens are stored as hashes at rest.
- Reset token consumption supports migration-safe lookup by hash first.
- Invitation storage avoids persisting raw tokenized links.
- Raw token values are only returned to the intended delivery path.

## Retention and Data Lifecycle

- Session retention cleanup is implemented in `session-store`.
- Cleanup is started on runtime path and runs on a configured interval.
- Retention windows are configurable via environment settings.

## Transport and Header Hardening

- Security response headers are set via edge proxy/middleware:
  - CSP
  - HSTS (production)
  - X-Frame-Options
  - Referrer-Policy
  - X-Content-Type-Options

## Dependency Security and Gates

- Runtime dependency threshold for launch:
  - no high/critical vulnerabilities
- Required runtime gate:
  - `npm audit --omit=dev --audit-level=high`

## Required Verification

- Security regression tests cover authz outcomes, token lifecycle, and retention behavior.
- Release candidate validation includes:
  - `npm test` (security regression subset)
  - `npm audit --omit=dev --audit-level=high`
