# Security and HIPAA Compliance Guide

This guide is the launch-facing summary of technical, operational, and administrative controls for the `patient-intake-2` platform.

## Scope

- Branch context: `security/hipaa-hardening-phase1`
- Data context: PHI in intake sessions, transcription artifacts, prescriptions, lab requisitions, and patient records.
- Release policy: no known high/critical runtime vulnerabilities at launch.

## Control Domains

- Technical safeguards: see `docs/compliance/technical-safeguards.md`
- Operational safeguards: see `docs/compliance/operational-safeguards.md`
- Administrative safeguards: see `docs/compliance/administrative-safeguards.md`

## Core Technical Controls (implemented)

- Auth/session hardening:
  - secure, httpOnly cookies
  - server-side session invalidation
  - idle and absolute session bounds
- Workforce and org-scoped authorization:
  - route-level scope checks for PHI endpoints
  - cross-org access denied
- PHI audit logging:
  - successful PHI reads/writes/export actions are logged
  - auth events logged with non-PHI metadata
- Token security:
  - password reset tokens stored as hashes
  - invitation links not persisted with raw token values
- Retention:
  - session retention cleanup implemented and scheduled
- Security transport headers:
  - CSP, X-Frame-Options, HSTS (prod), and related headers
- Abuse resistance:
  - durable auth endpoint rate limiting for login/register/reset

## Compliance Artifacts and Evidence

- Compliance index: `docs/compliance/README.md`
- Launch evidence matrix: `docs/compliance/launch-evidence-matrix.md`
- Vendor BAA register: `docs/compliance/vendor-baa-register.md`
- Risk acceptance artifact:
  - `SECURITY_RISK_ACCEPTANCE_P0-4B.md`

## Launch Gate (must pass)

1. Runtime security audit passes with no high/critical vulnerabilities:
   - `npm audit --omit=dev --audit-level=high`
2. Security regression suite passes for PHI routes, token workflows, and retention cleanup.
3. All required compliance artifacts are populated with owner and review date.
4. Open risks are either remediated or approved with expiration and closure criteria.

## Review Cadence

- Weekly during launch hardening: technical + compliance sync.
- Monthly post-launch: audit evidence review, vulnerability review, and risk acceptance validation.
