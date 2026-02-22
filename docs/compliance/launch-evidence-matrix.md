# Launch Evidence Matrix

This matrix links launch controls to objective evidence, owner, and closure criteria.

## Technical Controls

- Control ID: T-01
  - Control: Reset tokens stored hashed at rest
  - Evidence: `src/app/api/auth/reset-password/route.ts`, `src/lib/migrations/020_harden_reset_tokens.sql`, reset token tests
  - Owner: Engineering
  - Status: implemented
  - Last review: 2026-02-22
  - Closure criteria: regression tests remain green

- Control ID: T-02
  - Control: No raw invitation tokenized link persisted
  - Evidence: `src/app/api/invitations/send/route.ts`, `src/lib/migrations/021_remove_raw_invitation_link_storage.sql`
  - Owner: Engineering
  - Status: implemented
  - Last review: 2026-02-22
  - Closure criteria: DB records validated in staging

- Control ID: T-03
  - Control: PHI retention cleanup active
  - Evidence: `src/lib/session-store.ts`, `src/lib/session-retention-cleanup.ts`, `src/lib/session-store.cleanup.test.ts`
  - Owner: Engineering/Ops
  - Status: implemented
  - Last review: 2026-02-22
  - Closure criteria: staged runtime cleanup observed

- Control ID: T-04
  - Control: Workforce/org-scoped PHI authorization + audit
  - Evidence: hardened session/prescription/lab/transcription routes + tests
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-22
  - Closure criteria: security regression suite passes

- Control ID: T-05
  - Control: Auth endpoint durable rate limiting
  - Evidence: `src/lib/rate-limit.ts`, auth route updates
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-22
  - Closure criteria: rate-limit behavior verified in staging

- Control ID: T-06
  - Control: Runtime vulnerabilities high/critical = 0
  - Evidence: `npm audit --omit=dev --audit-level=high`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-22
  - Closure criteria: CI gate enforced and passing

## Operational Controls

- Control ID: O-01
  - Control: Incident response + breach notification runbook
  - Evidence: `docs/compliance/runbooks/incident-response-and-breach-notification.md`
  - Owner: Security/Compliance
  - Status: documented_pending_approval
  - Last review: 2026-02-22
  - Closure criteria: approved runbook published

- Control ID: O-02
  - Control: Backup and restore validation
  - Evidence: `docs/compliance/runbooks/backup-disaster-recovery-sop.md` plus restore test log and RTO/RPO record
  - Owner: Ops
  - Status: documented_pending_evidence
  - Last review: 2026-02-22
  - Closure criteria: restore drill completed

- Control ID: O-03
  - Control: Access review process
  - Evidence: `docs/compliance/runbooks/access-provisioning-and-review-sop.md` and first review output
  - Owner: Security/IT
  - Status: documented_pending_approval
  - Last review: 2026-02-22
  - Closure criteria: first review completed and signed

## Administrative Controls

- Control ID: A-01
  - Control: Vendor BAAs complete for PHI paths
  - Evidence: `docs/compliance/vendor-baa-register.md`
  - Owner: Legal/Compliance
  - Status: documented_pending_execution
  - Last review: 2026-02-22
  - Closure criteria: all required vendors marked executed

- Control ID: A-02
  - Control: Workforce HIPAA training evidence
  - Evidence: training roster and attestation records
  - Owner: HR/Compliance
  - Status: pending
  - Last review: 2026-02-22
  - Closure criteria: completion threshold met

- Control ID: A-03
  - Control: Sanctions policy and officer designation
  - Evidence: `docs/compliance/administrative-safeguards.md` plus approved policy and named security/privacy officers
  - Owner: Compliance/Leadership
  - Status: documented_pending_execution
  - Last review: 2026-02-22
  - Closure criteria: policy approved and communicated

## Risk Acceptance Tracking

- Risk ID: R-01
  - Source: `SECURITY_RISK_ACCEPTANCE_P0-4B.md`
  - Description: Temporary acceptance for minimatch transitive chain (now superseded by runtime remediation)
  - Owner: Engineering/Security
  - Status: pending_formal_closure
  - Expiration: 2026-03-31
  - Compensating controls: lockfile installs, protected branch deploys, periodic audit checks
  - Closure criteria:
    1. Runtime audit remains zero high/critical
    2. Formal sign-off updates the risk record status to closed or superseded
