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
  - Evidence: `npm audit --omit=dev --audit-level=high`, `docs/compliance/evidence/technical-gates-2026-03-02.md`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-03-02
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

- Control ID: T-15
  - Control: ASVS V7 L2 applicable session controls are enforced and evidenced (timeouts, rotation, termination, and admin revocation)
  - Evidence: `docs/compliance/runbooks/v7-session-management-l2.md`, `src/lib/auth.ts`, `src/app/api/auth/ping/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/reset-password/[token]/route.ts`, `src/app/api/admin/providers/[id]/route.ts`, `src/app/api/org/providers/[id]/route.ts`, `src/app/api/admin/sessions/terminate/route.ts`, `src/app/api/org/sessions/terminate/route.ts`, `src/lib/auth.test.ts`, `src/app/api/auth/ping/route.test.ts`, `src/app/api/auth/logout/route.test.ts`, `src/app/api/auth/reset-password/[token]/route.test.ts`, `src/app/api/admin/providers/[id]/route.test.ts`, `src/app/api/org/providers/[id]/route.test.ts`, `src/app/api/admin/sessions/terminate/route.test.ts`, `src/app/api/org/sessions/terminate/route.test.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-03-01
  - Next review: 2026-04-01
  - Closure criteria: tests continue to prove idle timeout + absolute lifetime enforcement, refresh-time token rotation, logout/session revocation on factor changes, and admin session termination APIs for scoped/global workflows

- Control ID: T-16
  - Control: ASVS V7 L2 non-applicable controls are explicitly documented with rationale for current auth model (`V7.1.3`, `V7.5.1`, `V7.5.2`, `V7.6.1`)
  - Evidence: `docs/compliance/runbooks/v7-session-management-l2.md`
  - Owner: Security/Compliance
  - Status: n/a_by_design
  - Last review: 2026-03-01
  - Next review: 2026-04-01
  - Closure criteria: applicability rationale remains current with deployed auth/session architecture and is re-reviewed on auth model changes

- Control ID: T-17
  - Control: ASVS V8 L2 applicable authorization controls are enforced and evidenced (role, object, and tenant boundaries)
  - Evidence: `docs/compliance/runbooks/v8-authorization-l2.md`, `docs/compliance/authorization-matrix-v10.2.2.md`, `docs/compliance/authorization-matrix-v10.3.2.md`, `src/lib/session-access.ts`, `src/app/api/patients/[patientId]/route.ts`, `src/app/api/org/providers/[id]/route.ts`, `src/app/api/sessions/list/route.ts`, `src/app/api/prescriptions/fax/route.ts`, `src/app/api/lab-requisitions/generate/route.ts`, `src/app/api/lab-requisitions/editor-session/route.ts`, `src/app/api/physician/translate-final-comments/route.ts`, `src/app/api/prescriptions/fax/route.test.ts`, `src/app/api/lab-requisitions/generate/route.test.ts`, `src/app/api/lab-requisitions/editor-session/route.test.ts`, `src/app/api/physician/translate-final-comments/route.test.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-03-01
  - Next review: 2026-04-01
  - Closure criteria: role/object/tenant deny-path tests remain green for mapped high-risk routes and authorization matrices remain aligned to endpoint behavior

- Control ID: T-18
  - Control: ASVS V9 L2 applicable self-contained token controls are enforced and evidenced (issuer/audience/type/context + tamper/replay resistance)
  - Evidence: `docs/compliance/runbooks/v9-self-contained-token-policy-l2.md`, `src/lib/token-claims.ts`, `src/app/api/auth/reset-password/route.ts`, `src/app/api/auth/reset-password/[token]/route.ts`, `src/lib/auth-mfa.ts`, `src/lib/invitation-security.ts`, `src/app/api/admin/organizations/[id]/emr/oscar/connect/route.ts`, `src/app/api/admin/emr/oscar/callback/route.ts`, `src/lib/migrations/028_add_token_claim_columns.sql`, `src/lib/migrations/029_add_invitation_session_token_claim_columns.sql`, `src/lib/migrations/030_add_emr_oauth_request_token_claim_columns.sql`, `src/lib/migrations/031_create_emr_oauth_requests_table.sql`, `src/app/api/auth/reset-password/[token]/route.test.ts`, `src/lib/auth-mfa.test.ts`, `src/lib/invitation-security.test.ts`, `src/app/api/admin/emr/oscar/callback/route.test.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-03-01
  - Next review: 2026-04-01
  - Closure criteria: token claim mismatch/tamper/replay tests continue to fail closed and claim-bound token issuance/consumption paths remain mapped in runbook evidence

- Control ID: T-19
  - Control: ASVS V8/V9 L2 non-applicable controls are explicitly documented for this scoped assessment set
  - Evidence: `docs/compliance/runbooks/v8-authorization-l2.md`, `docs/compliance/runbooks/v9-self-contained-token-policy-l2.md`
  - Owner: Security/Compliance
  - Status: n/a_by_scope
  - Last review: 2026-03-01
  - Next review: 2026-04-01
  - Closure criteria: when assessment scope introduces additional V8/V9 rows, runbooks and matrix are updated with explicit applicability rationale before status attestation

- Control ID: T-20
  - Control: ASVS V1 L2 partial controls are closed with centralized canonicalization, safe deserialization, outbound URL guardrails, and sink hardening
  - Evidence: `docs/compliance/runbooks/v1-encoding-sanitization-l2.md`, `src/lib/canonicalization.ts`, `src/lib/safe-json.ts`, `src/lib/outbound-url.ts`, `src/lib/patient-phi.ts`, `src/lib/lab-requisition-mapping.ts`, `src/lib/auth.ts`, `src/lib/oscar/client.ts`, `src/lib/invitation-pdf-summary.ts`, `src/app/api/admin/organizations/[id]/emr/oscar/route.ts`, `src/app/api/speech/stt/route.ts`, `src/app/api/speech/tts/route.ts`, `src/app/physician/view/page.tsx`, `public/eforms/1.1LabRequisition/LabDecisionSupport4_Feb2019.js`, `public/eforms/1.1LabRequisition/1.1LabRequisition.html`, `src/lib/outbound-url.test.ts`, `src/lib/safe-json.test.ts`, `src/lib/security-regressions.test.ts`, `src/lib/patient-phi.test.ts`, `src/lib/auth.test.ts`, `src/lib/invitation-pdf-summary.test.ts`, `src/app/api/admin/organizations/[id]/emr/oscar/route.test.ts`, `src/app/api/lab-requisitions/generate/route.test.ts`, `src/app/api/speech/stt/route.test.ts`, `src/app/api/speech/tts/route.test.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-02-26
  - Next review: 2026-03-26
  - Closure criteria: V1 security regression and route-level negative tests remain green in CI and ASVS V1 CSV rows stay synchronized with code/test evidence

- Control ID: T-26
  - Control: File upload security controls (MIME allowlist, magic-number validation, size limit, HIPAA-mode fail-closed guard)
  - Evidence: `docs/compliance/runbooks/file-upload-security.md`, `src/app/api/analyze-lesion/route.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-03-13
  - Next review: 2026-04-13
  - Closure criteria: upload endpoint enforces MIME allowlist, magic-number check, 10 MB size limit, and returns 503 in HIPAA mode; virus scanning requirement documented and gated on PHI-path enablement

- Control ID: T-27
  - Control: Password policy documented and mapped to enforcement evidence (length, character class, context-word prohibition, breach check, hashing) (ASVS V6.1.1, V6.1.2, V6.1.3, V6.2.1)
  - Evidence: `docs/compliance/runbooks/password-policy.md`, `src/lib/auth.ts`, `src/lib/password-context.ts`, `src/lib/password-breach.ts`, `src/app/api/auth/register/route.ts`, `src/app/api/auth/reset-password/[token]/route.ts`, `src/app/api/admin/providers/[id]/route.ts`, `src/app/api/org/providers/[id]/route.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-03-13
  - Next review: 2026-04-13
  - Closure criteria: password policy runbook remains current with all four ASVS controls mapped to code and test evidence; tests remain green across all enforcement paths

- Control ID: T-21
  - Control: PHI production scope boundary is explicitly documented and enforced by HIPAA-mode fail-closed behavior for all external AI routes
  - Evidence: `docs/compliance/phi-production-scope.md`, `docs/compliance/evidence/baa-review-2026-03-13.md`, `src/app/api/history/route.ts`, `src/app/api/analyze-med-pmh/route.ts`, `src/app/api/analyze-lesion/route.ts`, `src/app/api/lab-requisitions/generate/route.ts`, `src/app/api/speech/clean/route.ts`, `src/app/api/speech/stt/route.ts`, `src/app/api/speech/tts/route.ts`, `src/app/api/interview/route.ts`, `src/app/api/analyze-form/route.ts`, `src/app/api/analyze-lab-report/route.ts`, `src/app/api/translate/route.ts`, `src/app/api/physician/transcription/generate/route.ts`, `src/app/api/physician/transcription/ask-ai/route.ts`, `src/app/api/physician/translate-final-comments/route.ts`, `src/app/api/physician/hpi-actions/route.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-03-13
  - Next review: 2026-04-13
  - Gap resolved: 2026-03-13 — `POST /api/history` (Google Gemini) and `POST /api/analyze-med-pmh` (Azure OpenAI Vision) were missing HIPAA_MODE guards; both now return HTTP 503 in HIPAA mode. Gap finding documented in `docs/compliance/evidence/baa-review-2026-03-13.md`.
  - Closure criteria: all routes in `docs/compliance/phi-production-scope.md` external AI list return fail-closed 503 when `HIPAA_MODE=true`; phi-production-scope.md route inventory stays synchronized with deployed code

- Control ID: T-22
  - Control: Production database TLS certificate validation enforced
  - Evidence: `src/lib/db.ts`
  - Owner: Engineering/Security
  - Status: implemented
  - Last review: 2026-03-02
  - Next review: 2026-04-02
  - Closure criteria: production DB pool rejects untrusted certificates (`rejectUnauthorized=true`)

- Control ID: T-23
  - Control: Google SSO (NextAuth) removed — not used in production; workforce authentication uses native username/password + MFA
  - Evidence: removal commit 2026-03-13; `src/auth.ts`, `src/app/api/auth/[...nextauth]/`, `src/app/auth/signin/` deleted; `next-auth` dependency removed from `package.json`
  - Owner: Engineering/Security
  - Status: removed
  - Last review: 2026-03-13
  - Closure criteria: n/a — feature removed; SSO may be re-introduced via a future controlled change with BAA assessment and domain allowlist configuration

- Control ID: T-24
  - Control: Product/UI language avoids premature formal HIPAA attestation prior to legal close
  - Evidence: login pages, invitation email template, and marketing content updates under `src/app/**`
  - Owner: Product/Engineering
  - Status: implemented
  - Last review: 2026-03-02
  - Next review: 2026-04-02
  - Closure criteria: no user-facing copy asserts formal HIPAA compliance without completed legal sign-off

- Control ID: T-25
  - Control: Azure/runtime network and secret hardening controls are attested at launch (private-network posture, egress restrictions, TLS/secrets handling)
  - Evidence: `DEPLOYMENT.md`, `docs/compliance/evidence/azure-runtime-attestation-2026-03-02.md`
  - Owner: Ops/Security
  - Status: implemented_attested
  - Last review: 2026-03-02
  - Next review: 2026-04-02
  - Closure criteria: monthly attestation remains current and deployment checks continue to enforce private-network/TLS/secret requirements

## Operational Controls

- Control ID: O-01
  - Control: Incident response + breach notification runbook
  - Evidence: `docs/compliance/runbooks/incident-response-and-breach-notification.md`
  - Owner: Security/Compliance
  - Status: implemented
  - Last review: 2026-03-02
  - Closure criteria: approved runbook published

- Control ID: O-02
  - Control: Backup and restore validation
  - Evidence: `docs/compliance/runbooks/backup-disaster-recovery-sop.md`, `docs/compliance/evidence/restore-drill-2026-03-02.md`
  - Owner: Ops
  - Status: implemented
  - Last review: 2026-03-02
  - Closure criteria: restore drill completed

- Control ID: O-03
  - Control: Access review process
  - Evidence: `docs/compliance/runbooks/access-provisioning-and-review-sop.md`, `docs/compliance/evidence/access-review-2026-03-02.md`
  - Owner: Security/IT
  - Status: implemented
  - Last review: 2026-03-02
  - Closure criteria: first review completed and signed

- Control ID: O-04
  - Control: Monitoring and alert validation for auth anomalies, PHI route failures, and reliability events
  - Evidence: `docs/compliance/operational-safeguards.md`, `docs/compliance/evidence/monitoring-and-alert-validation-2026-03-02.md`, `docs/compliance/runbooks/incident-response-and-breach-notification.md`
  - Owner: Security/Ops
  - Status: implemented_attested
  - Last review: 2026-03-02
  - Next review: 2026-04-02
  - Closure criteria: alert catalog and validation evidence are refreshed on monthly cadence and incident workflow remains mapped

## Physical Safeguard Controls

- Control ID: P-04
  - Control: Endpoint malware protection — macOS native AV (XProtect, Gatekeeper, MRT) on developer endpoints; fail-closed file upload gate as production compensating control
  - Evidence: `docs/compliance/evidence/endpoint-malware-protection-attestation-2026-03-30.md`, `docs/compliance/runbooks/file-upload-security.md`, `docs/compliance/physical-safeguards.md` (§P-04)
  - Owner: Security/Operations / Manucher Mehraein
  - Status: implemented_attested
  - Last review: 2026-03-30
  - Next review: 2026-06-30
  - Closure criteria: macOS native AV controls remain enabled on all developer endpoints; production file upload endpoint remains fail-closed in HIPAA mode; attestation refreshed quarterly

- Control ID: P-01
  - Control: Facility access and workspace controls for PHI administration
  - Evidence: `docs/compliance/physical-safeguards.md`, `docs/compliance/evidence/physical-safeguards-attestation-2026-03-02.md`
  - Owner: Security/Operations
  - Status: implemented_attested
  - Last review: 2026-03-02
  - Next review: 2026-06-02
  - Closure criteria: quarterly attestation confirms controlled workspace access and unattended lock/storage controls

- Control ID: P-02
  - Control: Workstation/device/media safeguards (disk encryption, screen lock, approved devices, secure disposal)
  - Evidence: `docs/compliance/physical-safeguards.md`, `docs/compliance/evidence/physical-safeguards-attestation-2026-03-02.md`
  - Owner: Security/Operations
  - Status: implemented_attested
  - Last review: 2026-03-02
  - Next review: 2026-06-02
  - Closure criteria: quarterly review confirms endpoint hardening baseline and device/media handling/disposal controls

## Administrative Controls

- Control ID: A-01
  - Control: Vendor BAA coverage confirmed for all PHI-path vendors; Microsoft Azure
    covered via DPA/Product Terms (no separately signed document); all other PHI-path
    vendors either covered or PHI paths technically disabled
  - Evidence: `docs/compliance/vendor-baa-register.md`,
    `docs/compliance/evidence/baa-execution-log-2026-03-02.md`,
    `docs/compliance/evidence/baa-review-2026-03-13.md`,
    `docs/compliance/evidence/microsoft-dpa-baa-reference-2026-03-13.md`
  - Owner: Manucher Mehraein (Compliance/Engineering)
  - Status: implemented
  - Last review: 2026-03-13
  - Next review: 2026-06-02
  - Closure criteria: all PHI-path vendors hold status `executed` or
    `covered_via_product_terms`; `not_required_documented` vendors have PHI paths
    technically disabled; no new PHI-path vendor added without BAA assessment

- Control ID: A-02
  - Control: Workforce HIPAA training evidence
  - Evidence: `docs/compliance/evidence/training-and-sanctions-attestation-2026-03-02.md`
  - Owner: HR/Compliance
  - Status: implemented
  - Last review: 2026-03-02
  - Closure criteria: completion threshold met

- Control ID: A-06
  - Control: Vulnerability assessment program — SAST (CodeQL), dependency scanning (npm audit CI gate), and annual penetration test cadence
  - Evidence: `docs/compliance/runbooks/vulnerability-assessment-program.md`, `.github/workflows/codeql.yml`, `.github/workflows/main_healt-assist-ai-prod.yml`, `docs/compliance/evidence/technical-gates-2026-03-02.md`
  - Owner: Security Officer / Manucher Mehraein
  - Status: implemented (dependency scan + SAST); scheduled (pen test — first due 2027-03-02)
  - Last review: 2026-03-30
  - Next review: 2027-03-30
  - Closure criteria: CodeQL workflow active on main and PRs; npm audit gate passing in CI; pen test completed and findings documented annually

- Control ID: A-04
  - Control: Internet and Email Usage Policy documented and acknowledged by all workforce members
  - Evidence: `docs/compliance/runbooks/internet-email-usage-policy.md`, `docs/compliance/evidence/internet-email-policy-acknowledgment-2026-03-30.md`
  - Owner: Security Officer / Manucher Mehraein
  - Status: implemented
  - Last review: 2026-03-30
  - Next review: 2027-03-30
  - Closure criteria: policy published; all workforce members have signed acknowledgment on file; policy refreshed annually and after material changes

- Control ID: A-03
  - Control: Sanctions policy and officer designation
  - Evidence: `docs/compliance/administrative-safeguards.md`, `docs/compliance/evidence/officer-designation-2026-03-02.md`, `docs/compliance/evidence/training-and-sanctions-attestation-2026-03-02.md`
  - Owner: Compliance/Leadership
  - Status: implemented
  - Last review: 2026-03-02
  - Closure criteria: policy approved and communicated

- Control ID: A-05
  - Control: Content takedown and intellectual property complaints procedure (DMCA / Canadian Copyright Act / defamation / trademark)
  - Evidence: `docs/compliance/runbooks/content-takedown-and-ip-complaints.md`, `src/app/terms/page.tsx` (§19 — IP Complaints and Content Takedown)
  - Owner: Security/Privacy Officer / Manucher Mehraein
  - Status: implemented
  - Last review: 2026-03-30
  - Next review: 2027-03-30
  - Closure criteria: internal runbook published with designated agent, response timeline, and counter-notification process; public-facing procedure present in Terms of Use §19; annual review completed

## Risk Acceptance Tracking

- Risk ID: R-01
  - Source: `SECURITY_RISK_ACCEPTANCE_P0-4B.md`
  - Description: Temporary acceptance for minimatch transitive chain (now superseded by runtime remediation)
  - Owner: Engineering/Security
  - Status: closed
  - Expiration: 2026-03-31
  - Compensating controls: lockfile installs, protected branch deploys, periodic audit checks
  - Closure criteria:
    1. Runtime audit remains zero high/critical
    2. Risk acceptance artifact is updated with closure/superseded status and signed approval record
