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

- Control ID: T-07
  - Control: Password reset does not bypass enabled MFA (ASVS V6.4.3)
  - Evidence: `src/lib/auth-mfa.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/login/mfa/verify/route.ts`, `src/app/api/auth/reset-password/[token]/route.ts`, `src/lib/migrations/025_add_auth_mfa_primitives.sql`, auth MFA route tests
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-26
  - Closure criteria: MFA-enabled reset requires OTP verification in regression tests

- Control ID: T-08
  - Control: Provider MFA enrollment is admin-enforced (ASVS V6.4.4 enrollment)
  - Evidence: `src/app/api/admin/providers/[id]/route.ts`, `src/app/api/org/providers/[id]/route.ts`, provider edit pages under `src/app/admin/organizations/[id]/providers/[providerId]/edit/page.tsx` and `src/app/org/providers/[id]/edit/page.tsx`, provider route tests
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-27
  - Closure criteria: provider MFA toggle persists via API and is visible in admin/org edit flows

- Control ID: T-09
  - Control: Workforce MFA challenge + backup-code recovery supports provider/org-admin/super-admin users (ASVS V6.4.4 recovery)
  - Evidence: `src/lib/migrations/026_add_mfa_backup_recovery_codes.sql`, `src/lib/migrations/027_add_mfa_recovery_versioning.sql`, `src/lib/auth-mfa.ts`, `src/app/api/auth/login/mfa/recovery/route.ts`, `src/app/api/admin/providers/[id]/mfa/backup-codes/route.ts`, `src/app/api/org/providers/[id]/mfa/backup-codes/route.ts`, `src/app/api/admin/organization-users/[id]/mfa/backup-codes/route.ts`, `src/app/api/admin/super-admin-users/[id]/mfa/backup-codes/route.ts`, `src/app/api/admin/super-admin-users/[id]/mfa/backup-codes/route.test.ts`, MFA verify/recovery tests, `src/lib/auth-mfa.test.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-27
  - Closure criteria: backup codes generate/rotate/status for all workforce types and one-time recovery login behavior validated in tests

- Control ID: T-10
  - Control: Admin-assisted MFA recovery reset invalidates old recovery artifacts and keeps MFA enabled (ASVS V6.4.4 admin reset)
  - Evidence: `src/lib/migrations/027_add_mfa_recovery_versioning.sql`, `src/lib/auth-mfa.ts`, `src/app/api/admin/providers/[id]/mfa/reset-recovery/route.ts`, `src/app/api/org/providers/[id]/mfa/reset-recovery/route.ts`, `src/app/api/admin/organization-users/[id]/mfa/reset-recovery/route.ts`, `src/app/api/admin/super-admin-users/[id]/mfa/reset-recovery/route.ts`, `src/app/admin/dashboard/page.tsx`, `src/app/admin/organizations/[id]/page.tsx`, reset/recovery tests
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-27
  - Closure criteria: admin reset leaves `mfa_enabled=true`, invalidates prior backup-code recovery, and forces fresh backup code generation

- Control ID: T-11
  - Control: Context-specific password words are documented and mapped to enforcement evidence (ASVS V6.1.2)
  - Evidence: `docs/compliance/runbooks/password-context-word-policy.md`, `src/lib/password-context.ts`, `src/lib/password-context.test.ts`, `src/app/api/auth/register/route.ts`, `src/app/api/auth/register/route.test.ts`, `src/app/api/auth/reset-password/[token]/route.ts`, `src/app/api/auth/reset-password/[token]/route.test.ts`, `src/app/api/admin/providers/[id]/route.ts`, `src/app/api/admin/providers/[id]/route.test.ts`, `src/app/api/org/providers/[id]/route.ts`, `src/app/api/org/providers/[id]/route.test.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-27
  - Next review: 2026-03-27
  - Closure criteria: context-word list is reviewed on schedule and automated tests demonstrate context-word rejection across registration, reset, and admin/org password update flows

- Control ID: T-12
  - Control: Credential recovery tokens are single-use, context-bound, and replay-resistant (ASVS V6.3.4)
  - Evidence: `docs/compliance/runbooks/credential-recovery-token-policy.md`, `src/app/api/auth/reset-password/route.ts`, `src/app/api/auth/reset-password/[token]/route.ts`, `src/lib/token-claims.ts`, `src/lib/migrations/028_add_token_claim_columns.sql`, `src/app/api/auth/reset-password/route.test.ts`, `src/app/api/auth/reset-password/[token]/route.test.ts`, `src/app/api/auth/login/mfa/verify/route.test.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-27
  - Next review: 2026-03-27
  - Closure criteria: tests continue to prove token claim matching, single-use consumption, expiry rejection, and active-session invalidation after successful password reset

- Control ID: T-13
  - Control: PSTN OTP (SMS/voice) is not offered as an out-of-band authentication pathway; non-PSTN channels are explicitly documented and evidenced (ASVS V6.6.1)
  - Evidence: `docs/compliance/runbooks/oob-pstn-auth-policy.md`, `docs/compliance/runbooks/v6-authenticator-applicability-l2.md`, `src/lib/auth-policy.ts`, `src/lib/auth-policy.test.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/login/route.test.ts`, `src/lib/auth-mfa.ts`, `src/app/api/auth/login/mfa/verify/route.ts`, `src/app/api/auth/login/mfa/recovery/route.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-27
  - Next review: 2026-03-27
  - Closure criteria: published auth policy keeps `allowPstnOtp=false`, login MFA responses expose only supported non-PSTN channels, and regression tests remain green proving no PSTN OTP pathway is available

- Control ID: T-14
  - Control: Invitation email OTP request/verify flow enforces abuse controls and verified-session issuance boundaries (ASVS V6 L2 applicable control for deployed email OTP path)
  - Evidence: `src/app/api/invitations/otp/request/route.ts`, `src/app/api/invitations/otp/verify/route.ts`, `src/lib/invitation-security.ts`, `src/app/api/invitations/otp/request/route.test.ts`, `src/app/api/invitations/otp/verify/route.test.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-27
  - Next review: 2026-03-27
  - Closure criteria: OTP request/verify routes continue to enforce 400/404/429 controls and successful verify creates scoped invitation session cookie

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
