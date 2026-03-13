# Master Security Control Inventory

## Document Purpose

This document is the consolidated security control inventory for `patient-intake-2`, intended for audit and legal/compliance review. It compiles implemented controls from code, runtime configuration guidance, compliance runbooks, evidence artifacts, and risk records.

## Scope and Source Baseline

Primary sources used:

- `docs/compliance/launch-evidence-matrix.md`
- `docs/compliance/release-candidate-go-no-go.md`
- `docs/compliance/phi-production-scope.md`
- `docs/compliance/technical-safeguards.md`
- `docs/compliance/operational-safeguards.md`
- `docs/compliance/administrative-safeguards.md`
- `docs/compliance/vendor-baa-register.md`
- `docs/compliance/runbooks/*.md`
- `docs/compliance/evidence/*.md`
- `src/lib/*.ts`, `src/auth.ts`, `src/proxy.ts`, `src/app/api/**`
- `DEPLOYMENT.md`
- `SECURITY_HIPAA_COMPLIANCE_GUIDE.md`
- `SECURITY_DEPENDENCY_AUDIT.md`
- `SECURITY_RISK_ACCEPTANCE_P0-4B.md`
- `HIPAA_READINESS_CHECKLIST.md`
- `HIPAA_IMPLEMENTATION_ASSESSMENT.md`

## Executive Summary

### Total Control Count

- Total controls inventoried: **39**

### Controls by Category

- Technical: **22**
- Infrastructure: **7**
- Operational: **6**
- Administrative: **4**

### HIPAA Security Rule Mapping Coverage

- Administrative safeguards: **8**
- Physical safeguards: **2**
- Technical safeguards: **29**

### Gaps Detected

1. ~~**Azure platform controls remain attestation-based rather than IaC-backed in-repo** (Private Endpoints, VNet, egress allowlists).~~ **Resolved 2026-03-13:** Bicep IaC added to `infrastructure/` — see INF-04.
2. **Runtime evidence dependency:** monthly attestation refresh still required for controls not covered by IaC (runtime key rotation, DB access logs).

## Methodology and De-duplication Rules

- Canonical control IDs (`T-*`, `O-*`, `A-*`, `R-*`) were preserved from `docs/compliance/launch-evidence-matrix.md`.
- Overlapping controls across code/docs/tests were merged into single control rows.
- Synthetic IDs were added only where implemented controls were documented outside the matrix:
  - `INF-01`, `INF-02`, `INF-03`, `INF-04`
- Owner/status/review cadence were taken from matrix/runbooks where available.
- If absent, values are explicitly marked `Not documented`.

---

## HIPAA Security Rule: Administrative Safeguards

| Control ID | Category | HIPAA Mapping | Control Description | Where Implemented (code/config/doc) | Evidence Location | Owner | Review Frequency | Current Status | Verification Method |
|---|---|---|---|---|---|---|---|---|---|
| O-01 | Operational | Administrative Safeguard | Incident response and breach notification runbook with triage, containment, investigation, recovery, and notification workflow. | `docs/compliance/runbooks/incident-response-and-breach-notification.md` | `docs/compliance/runbooks/incident-response-and-breach-notification.md`, `docs/compliance/release-candidate-go-no-go.md` | Security/Compliance | Not documented | Implemented | Runbook approval record and go/no-go checklist closure. |
| O-02 | Operational | Administrative Safeguard | Backup/restore and disaster recovery process with RTO/RPO and drill requirements. | `docs/compliance/runbooks/backup-disaster-recovery-sop.md` | `docs/compliance/evidence/restore-drill-2026-03-02.md`, `docs/compliance/launch-evidence-matrix.md` | Ops | Quarterly minimum (and pre-major release) | Implemented | Dated restore drill report with RTO/RPO outcome. |
| O-03 | Operational | Administrative Safeguard | Access provisioning lifecycle and periodic access reviews for PHI-relevant systems. | `docs/compliance/runbooks/access-provisioning-and-review-sop.md` | `docs/compliance/evidence/access-review-2026-03-02.md`, `docs/compliance/launch-evidence-matrix.md` | Security/IT | Monthly privileged; quarterly standard PHI roles | Implemented | Access review output + SOP approval record. |
| A-01 | Administrative | Administrative Safeguard | Vendor BAA governance for PHI touchpoints with launch gating rule. | `docs/compliance/vendor-baa-register.md` | `docs/compliance/evidence/baa-execution-log-2026-03-02.md`, `docs/compliance/phi-production-scope.md` | Legal/Compliance | Quarterly (next review documented: 2026-06-02) | Implemented | Vendor register status + BAA execution log approval. |
| A-02 | Administrative | Administrative Safeguard | Workforce HIPAA/security training and attestation coverage. | `docs/compliance/administrative-safeguards.md` | `docs/compliance/evidence/training-and-sanctions-attestation-2026-03-02.md` | HR/Compliance | Annual minimum | Implemented | Signed attestation with approval date. |
| A-03 | Administrative | Administrative Safeguard | Security/privacy officer designation and sanctions-policy governance. | `docs/compliance/administrative-safeguards.md` | `docs/compliance/evidence/officer-designation-2026-03-02.md`, `docs/compliance/evidence/training-and-sanctions-attestation-2026-03-02.md` | Compliance/Leadership | Annual minimum (role + acknowledgment) | Implemented | Officer designation record + attestation linkage. |
| R-01 | Administrative | Administrative Safeguard | Time-bounded risk acceptance with compensating controls and closure criteria. | `docs/compliance/launch-evidence-matrix.md`, `SECURITY_RISK_ACCEPTANCE_P0-4B.md` | `SECURITY_DEPENDENCY_AUDIT.md`, `SECURITY_RISK_ACCEPTANCE_P0-4B.md`, `docs/compliance/evidence/technical-gates-2026-03-02.md` | Engineering/Security | Expiration-based (2026-03-31) + monthly post-launch review (guide) | Closed (superseded by remediation evidence) | Confirm artifact status + approval signatures + zero high/critical runtime audit evidence. |
| O-04 | Operational | Administrative Safeguard | Monitoring and alert validation for auth anomalies, PHI route failures, and reliability incidents. | `docs/compliance/operational-safeguards.md`, incident runbook | `docs/compliance/evidence/monitoring-and-alert-validation-2026-03-02.md`, `docs/compliance/runbooks/incident-response-and-breach-notification.md` | Security/Ops | Monthly | Implemented (attested) | Validate alert catalog, periodic reviews, and incident-response linkage. |

---

## HIPAA Security Rule: Physical Safeguards

| Control ID | Category | HIPAA Mapping | Control Description | Where Implemented (code/config/doc) | Evidence Location | Owner | Review Frequency | Current Status | Verification Method |
|---|---|---|---|---|---|---|---|---|---|
| P-01 | Operational | Physical Safeguard | Facility access and workspace controls for PHI administration activities. | `docs/compliance/physical-safeguards.md` | `docs/compliance/evidence/physical-safeguards-attestation-2026-03-02.md` | Security/Operations | Quarterly | Implemented (attested) | Review attestation + quarterly workspace control check. |
| P-02 | Operational | Physical Safeguard | Workstation/device/media controls (encryption, screen lock, approved-device handling, secure disposal). | `docs/compliance/physical-safeguards.md` | `docs/compliance/evidence/physical-safeguards-attestation-2026-03-02.md` | Security/Operations | Quarterly | Implemented (attested) | Verify endpoint baseline and disposal/process attestations on review cycle. |

---

## HIPAA Security Rule: Technical Safeguards

| Control ID | Category | HIPAA Mapping | Control Description | Where Implemented (code/config/doc) | Evidence Location | Owner | Review Frequency | Current Status | Verification Method |
|---|---|---|---|---|---|---|---|---|---|
| T-01 | Technical | Technical Safeguard | Reset tokens stored as hashes at rest. | `src/app/api/auth/reset-password/route.ts`, `src/lib/migrations/020_harden_reset_tokens.sql` | `docs/compliance/launch-evidence-matrix.md`, auth reset tests | Engineering | Not documented | Implemented | Route tests validate hashed-token flow and rejection behavior. |
| T-02 | Technical | Technical Safeguard | No raw invitation tokenized link persistence. | `src/app/api/invitations/send/route.ts`, `src/lib/migrations/021_remove_raw_invitation_link_storage.sql` | `docs/compliance/launch-evidence-matrix.md` | Engineering | Not documented | Implemented | DB migration + invitation flow checks. |
| T-03 | Technical | Technical Safeguard | PHI session retention cleanup mechanism. | `src/lib/session-store.ts`, `src/lib/session-retention-cleanup.ts` | `src/lib/session-store.cleanup.test.ts`, `docs/compliance/launch-evidence-matrix.md` | Engineering/Ops | Not documented | Implemented | Cleanup tests + runtime cleanup invocation. |
| T-04 | Technical | Technical Safeguard | Workforce/org-scoped PHI authz plus audit pathways. | `src/lib/session-access.ts`, PHI routes under `src/app/api/**` | Security regression suite + matrix evidence | Engineering/Security | Not documented | Implemented | Negative/deny-path tests and scoped access assertions. |
| T-05 | Technical | Technical Safeguard | Durable auth endpoint rate limiting. | `src/lib/rate-limit.ts`, auth routes under `src/app/api/auth/**` | Auth route tests + `docs/compliance/launch-evidence-matrix.md` | Engineering/Security | Not documented | Implemented | 429 behavior and retry-window checks in tests. |
| T-06 | Technical | Technical Safeguard | Runtime dependency vulnerability gate (no high/critical). | CI workflow, `package.json` (`audit:prod`) | `docs/compliance/evidence/technical-gates-2026-03-02.md` | Engineering/Security | Per release candidate | Implemented | `npm audit --omit=dev --audit-level=high` evidence. |
| T-07 | Technical | Technical Safeguard | Password reset cannot bypass enabled MFA. | `src/lib/auth-mfa.ts`, login/reset routes | MFA tests + matrix row T-07 | Engineering/Security | Not documented | Implemented | MFA verification required before reset completion. |
| T-08 | Technical | Technical Safeguard | Provider MFA enrollment admin-enforced. | Admin/org provider routes + edit pages | Provider route tests + matrix row T-08 | Engineering/Security | Not documented | Implemented | Enrollment state persistence and UI/API visibility checks. |
| T-09 | Technical | Technical Safeguard | Workforce MFA challenge + backup-code recovery across user classes. | `src/lib/auth-mfa.ts`, MFA routes + migrations 026/027 | `src/lib/auth-mfa.test.ts`, route tests, matrix T-09 | Engineering/Security | Not documented | Implemented | Challenge, recovery, rotation, and one-time recovery verification tests. |
| T-10 | Technical | Technical Safeguard | Admin-assisted MFA recovery reset invalidates stale recovery artifacts. | MFA reset routes for provider/org/super-admin + migration 027 | Reset/recovery tests + matrix T-10 | Engineering/Security | Not documented | Implemented | Post-reset MFA state and invalidation checks. |
| T-11 | Technical | Technical Safeguard | Context-word password policy enforcement. | `src/lib/password-context.ts`, register/reset/admin/org routes | `src/lib/password-context.test.ts`, route tests, runbook | Engineering/Security | Monthly (next review documented 2026-03-27) | Implemented | Context-word rejection in registration/reset/update flows. |
| T-12 | Technical | Technical Safeguard | Credential recovery tokens are single-use and context-bound. | Reset request/consume routes + `src/lib/token-claims.ts` | Reset tests + matrix T-12 + policy runbook | Engineering/Security | Monthly (next review documented 2026-03-27) | Implemented | Claim matching, expiry, single-use, replay rejection tests. |
| T-13 | Technical | Technical Safeguard | PSTN OTP not offered as OOB auth factor. | `src/lib/auth-policy.ts`, login/MFA routes | `src/lib/auth-policy.test.ts`, login tests, PSTN runbooks | Engineering/Security | Monthly (next review documented 2026-03-27) | Implemented | Policy assertions and response-shape tests showing PSTN disabled. |
| T-14 | Technical | Technical Safeguard | Invitation OTP abuse controls and verified-session issuance boundaries. | Invitation OTP request/verify routes + invitation security library | OTP request/verify tests + matrix T-14 | Engineering/Security | Monthly (next review documented 2026-03-27) | Implemented | 400/404/429 controls and verified session creation tests. |
| T-15 | Technical | Technical Safeguard | Session controls: timeout, rotation, logout, revocation, admin termination APIs. | `src/lib/auth.ts`, auth ping/logout/reset, admin/org terminate routes | Auth/session tests + matrix T-15 | Engineering/Security | Monthly (next review documented 2026-04-01) | Implemented | Idle/absolute lifetime, token rotation, revocation tests. |
| T-16 | Technical | Technical Safeguard | Non-applicable V7 controls explicitly documented by design. | Session management runbook | `docs/compliance/runbooks/v7-session-management-l2.md` | Security/Compliance | Monthly (next review documented 2026-04-01) | N/A by design | Applicability rationale review against auth architecture changes. |
| T-17 | Technical | Technical Safeguard | V8 authorization controls across role/object/tenant boundaries. | Authorization matrix docs + high-risk route implementations | Route tests + matrices + runbook | Engineering/Security | Monthly (next review documented 2026-04-01) | Implemented | Deny-path and boundary tests for mapped endpoints. |
| T-18 | Technical | Technical Safeguard | V9 self-contained token controls (claims/tamper/replay resistance). | `src/lib/token-claims.ts`, reset/auth-mfa/invitation/EMR OAuth routes + migrations | Tests + runbook + matrix T-18 | Engineering/Security | Monthly (next review documented 2026-04-01) | Implemented | Token claim mismatch/tamper/replay fail-closed tests. |
| T-19 | Technical | Technical Safeguard | Non-applicable V8/V9 controls documented for scoped assessment set. | V8/V9 runbooks | `docs/compliance/runbooks/v8-authorization-l2.md`, `docs/compliance/runbooks/v9-self-contained-token-policy-l2.md` | Security/Compliance | Monthly (next review documented 2026-04-01) | N/A by scope | Applicability review and scope-change update checks. |
| T-20 | Technical | Technical Safeguard | V1 control set: canonicalization, safe JSON, outbound guardrails, sink hardening. | `src/lib/canonicalization.ts`, `src/lib/safe-json.ts`, `src/lib/outbound-url.ts`, selected routes/UI files | V1 tests + security regression tests + matrix T-20 | Engineering/Security | Monthly (next review documented 2026-03-26) | Implemented | Unit and route tests for sanitization and unsafe sink prevention. |
| T-21 | Technical | Technical Safeguard | PHI production boundary documented and enforced by HIPAA-mode fail-closed behavior. | `docs/compliance/phi-production-scope.md`, AI/voice route guards | Matrix T-21 + route tests + go/no-go | Engineering/Security | Monthly (next review documented 2026-04-02) | Implemented | Validate `HIPAA_MODE=true` returns fail-closed responses for external AI paths. |
| T-24 | Technical | Technical Safeguard | Product/UI language gate: no premature formal HIPAA attestation before legal sign-off. | Login pages, marketing pages/components, invitation email template | Matrix T-24 + release report | Product/Engineering | Monthly (next review documented 2026-04-02) | Implemented | Static content review and grep checks for prohibited claim phrases. |
| T-25 | Infrastructure | Technical Safeguard | Azure/runtime network and secret hardening controls are launch-attested for private-network posture, egress limits, TLS, and secret handling. | `DEPLOYMENT.md`, runtime configuration checklist docs | `docs/compliance/evidence/azure-runtime-attestation-2026-03-02.md`, `docs/compliance/release-candidate-go-no-go.md` | Ops/Security | Monthly | Implemented (attested) | Validate monthly attestation and runtime checklist conformance. |
| T-22 | Infrastructure | Technical Safeguard | Production DB TLS certificate validation enforced. | `src/lib/db.ts` | Matrix T-22 + release report | Engineering/Security | Monthly (next review documented 2026-04-02) | Implemented | Runtime config inspection (`rejectUnauthorized=true`) and connection behavior tests. |
| T-23 | Infrastructure | Technical Safeguard | Google SSO deny-by-default and explicit domain allowlist. | `src/auth.ts` | Matrix T-23 + release report | Engineering/Security | Monthly (next review documented 2026-04-02) | Implemented | Validate disabled by default and allowlist/domain enforcement when enabled. |
| INF-01 | Infrastructure | Technical Safeguard | Edge transport/header hardening (CSP, HSTS production, frame/type/referrer controls). | `src/proxy.ts` | `docs/compliance/technical-safeguards.md` | Engineering/Security | Not documented | Implemented | Header inspection on representative routes in production-like environment. |
| INF-02 | Infrastructure | Technical Safeguard | Environment hardening and required-production-variable fail-fast behavior. | `src/lib/required-env.ts`, `src/lib/azure-openai.ts`, `src/lib/azure-speech.ts`, `scripts/check-env-no-secrets.js`, `package.json` (`lint:env`) | Technical safeguards docs + script code | Engineering/Security | Not documented | Implemented | Production startup/env validation and CI `lint:env` execution. |
| INF-03 | Infrastructure | Technical Safeguard | Outbound URL and network egress guardrails at application layer (anti-SSRF checks). | `src/lib/outbound-url.ts` and usages in OSCAR/speech/PDF routes | `src/lib/outbound-url.test.ts`, matrix T-20 | Engineering/Security | Not documented | Implemented | Unit tests for blocked hosts/schemes and route-level failure behavior. |
| INF-04 | Infrastructure | Technical Safeguard | Azure network isolation controls for private endpoints/VNet/egress restrictions — codified as Bicep IaC. | `infrastructure/main.bicep`, `infrastructure/modules/vnet.bicep`, `infrastructure/modules/nsg.bicep`, `infrastructure/modules/private-endpoints.bicep`, `infrastructure/modules/private-dns.bicep`, `infrastructure/modules/app-service-vnet-integration.bicep` | `docs/compliance/evidence/azure-runtime-attestation-2026-03-02.md`, `DEPLOYMENT.md`, `.github/workflows/infra-deploy.yml` | Ops/Security | Monthly | Implemented (IaC-backed) | Deploy via `infra-deploy.yml` workflow (what-if then deploy); verify Private Endpoint connection state in Azure Portal; confirm App Service VNet Integration active under Networking tab. |

---

## Runtime and Azure Configuration Controls (Consolidated)

The following runtime/Azure-related controls are part of this inventory and must be validated at deployment time:

1. `HIPAA_MODE=true` for production PHI boundary enforcement.
2. `AUTH_ALLOW_SELF_REGISTER` unset or `false` for launch.
3. Strong `SESSION_SECRET` and secret storage in managed secret systems.
4. DB TLS certificate validation active in production (`src/lib/db.ts`).
5. Private network controls for Azure services (OpenAI/DB/storage) per `DEPLOYMENT.md` with dated attestation evidence.
6. Outbound egress restrictions to approved destinations only.
7. CI gate enforcement (`npm audit --omit=dev --audit-level=high`) before deploy.

---

## Missing Categories and Explicit Gaps

### 1) Category coverage status

- Physical safeguard coverage is now evidenced by:
  - `docs/compliance/physical-safeguards.md`
  - `docs/compliance/evidence/physical-safeguards-attestation-2026-03-02.md`
- Risk-status inconsistency is resolved; `R-01` is aligned to closed/superseded status across matrix + risk artifact.
- Monitoring evidence maturity is improved with dated validation evidence:
  - `docs/compliance/evidence/monitoring-and-alert-validation-2026-03-02.md`

### 2) Residual infrastructure evidence gap

- Azure network/security controls still do not have Terraform/Bicep/ARM artifacts in this repository.
- Current posture is **implemented_attested** and depends on monthly runtime attestation refresh.

---

## Appendix A: Source Traceability Map

- Matrix controls: `docs/compliance/launch-evidence-matrix.md`
- Go/no-go and sign-offs: `docs/compliance/release-candidate-go-no-go.md`
- PHI boundary: `docs/compliance/phi-production-scope.md`
- Technical safeguards: `docs/compliance/technical-safeguards.md`
- Operational safeguards: `docs/compliance/operational-safeguards.md`
- Administrative safeguards: `docs/compliance/administrative-safeguards.md`
- Physical safeguards: `docs/compliance/physical-safeguards.md`
- Vendor controls: `docs/compliance/vendor-baa-register.md`
- Runbooks: `docs/compliance/runbooks/*.md`
- Evidence records: `docs/compliance/evidence/*.md`
- Runtime/infrastructure config guidance: `DEPLOYMENT.md`
- Root security records:
  - `SECURITY_HIPAA_COMPLIANCE_GUIDE.md`
  - `SECURITY_DEPENDENCY_AUDIT.md`
  - `SECURITY_RISK_ACCEPTANCE_P0-4B.md`
  - `HIPAA_READINESS_CHECKLIST.md`
  - `HIPAA_IMPLEMENTATION_ASSESSMENT.md`

## Appendix B: Matrix ID Coverage

- Technical controls: `T-01` through `T-25` represented.
- Operational controls: `O-01` through `O-04` represented.
- Physical controls: `P-01` through `P-02` represented.
- Administrative controls: `A-01` through `A-03` represented.
- Risk acceptance: `R-01` represented.
- Additional non-matrix controls: `INF-01`, `INF-02`, `INF-03`, `INF-04` (no duplication with matrix IDs).
