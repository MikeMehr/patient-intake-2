# ASVS V6 L2 Authenticator Applicability (Current Build)

## Purpose

Define which ASVS V6 Level 2 controls are applicable to the current authentication model and map each applicable control to objective implementation and verification evidence.

## Current Authenticator Model

- Primary sign-in: username/password
- MFA factor: email OTP (when `mfa_enabled=true`)
- Recovery factor: one-time backup codes
- PSTN OTP (SMS/voice): not offered (`allowPstnOtp=false`)
- Level target in this runbook: ASVS Level 2

## Applicability Matrix (L2)

| Control | Applicability | Rationale | Primary evidence |
| --- | --- | --- | --- |
| `V6.1.2` | Applicable | Passwords must reject context-specific words tied to organization/system naming. | `src/lib/password-context.ts`, auth/register/reset/admin-org provider routes + tests |
| `V6.3.4` | Applicable | Credential recovery tokens are claim-bound, single-use, and replay-resistant. | reset token routes/tests + `src/lib/token-claims.ts` |
| `V6.4.3` | Applicable | Password reset must not bypass enabled MFA. | `src/app/api/auth/reset-password/[token]/route.ts` + MFA/reset tests |
| `V6.4.4` | Applicable | MFA enrollment/recovery/reset governance is implemented for workforce roles. | backup-code and reset-recovery routes/tests |
| `V6.6.1` | Applicable (boundary control) | PSTN OTP is explicitly not offered and therefore prevented by policy/config. | `src/lib/auth-policy.ts`, login policy response tests |

## Non-Applicable / Deferred-By-Design Notes (L2)

- Controls requiring unsupported factors (for example SMS OTP enablement requirements, or stronger L3-only factors) are not implemented in this build.
- This project documents factor boundaries explicitly to avoid false attestations for unsupported authentication pathways.

## Governance

- Control owner: Security + Engineering
- Last review: 2026-02-27
- Next review: 2026-03-27
- Review cadence: monthly and upon any authenticator model changes

## Reviewer Replay Command

- `npx vitest run --exclude ".next/**" "src/lib/password-context.test.ts" "src/lib/auth-policy.test.ts" "src/app/api/auth/login/route.test.ts" "src/app/api/auth/login/mfa/verify/route.test.ts" "src/app/api/auth/login/mfa/recovery/route.test.ts" "src/app/api/auth/reset-password/route.test.ts" "src/app/api/auth/reset-password/[token]/route.test.ts" "src/app/api/invitations/otp/request/route.test.ts" "src/app/api/invitations/otp/verify/route.test.ts" "src/app/api/admin/super-admin-users/[id]/mfa/backup-codes/route.test.ts"`
