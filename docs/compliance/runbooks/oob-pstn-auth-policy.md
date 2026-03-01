# Out-of-Band PSTN OTP Policy (ASVS V6.6.1)

## Purpose

Define and evidence the application's control posture for ASVS `V6.6.1` (PSTN-delivered OTP for authentication).

## Scope

- Workforce authentication and MFA challenge flows
- Password reset flows that require MFA continuity
- Out-of-band OTP delivery channels used by the application

## ASVS Control Mapping

- ASVS control: `V6.6.1`
- Applicability at ASVS L2: applicable as a documented **not-offered** factor boundary
- Related controls:
  - `V6.4.3` (password reset does not bypass enabled MFA)
  - `V6.4.4` (MFA recovery and reset governance)

## Applicability Decision (Current Build)

`V6.6.1` is addressed by **not offering PSTN OTP (SMS/voice phone OTP) as an authentication option** in this build.

- PSTN channel status: disabled/unsupported
- Available channels in scope: email OTP challenge and backup recovery codes
- ASVS L3 note: no PSTN option is exposed

## Policy Statement

1. PSTN OTP (SMS/voice) is not an allowed authentication mechanism in production or non-production environments unless formally approved and implemented under this policy.
2. Any future PSTN enablement must satisfy all `V6.6.1` conditions before release:
   - previously validated phone number
   - alternate stronger method (for example TOTP/passkey) is also offered
   - user-facing risk disclosure is provided and approved
3. Until those conditions are implemented and evidenced, PSTN OTP remains unavailable.

## Objective Implementation Evidence

- Auth channel policy and PSTN-disabled posture:
  - `src/lib/auth-policy.ts`
- MFA challenge issuance path (email OTP + backup-code recovery model):
  - `src/lib/auth-mfa.ts`
  - `src/app/api/auth/login/route.ts`
  - `src/app/api/auth/login/mfa/verify/route.ts`
  - `src/app/api/auth/login/mfa/recovery/route.ts`
- Password reset MFA continuity:
  - `src/app/api/auth/reset-password/[token]/route.ts`

## Objective Verification Evidence

- Login response exposes non-PSTN channel policy and does not advertise PSTN:
  - `src/app/api/auth/login/route.test.ts`
- Auth policy constants enforce PSTN-disabled defaults:
  - `src/lib/auth-policy.test.ts`
- Existing MFA and reset tests demonstrating challenge/recovery controls:
  - `src/lib/auth-mfa.test.ts`
  - `src/app/api/auth/login/mfa/verify/route.test.ts`
  - `src/app/api/auth/login/mfa/recovery/route.test.ts`
  - `src/app/api/auth/reset-password/[token]/route.test.ts`

## Governance

- Control owner: Security + Engineering
- Policy approver: Security lead (Compliance reviewer for evidence mapping updates)
- Last review: 2026-02-27
- Next review: 2026-03-27
- Review cadence: monthly, and immediately after:
  - introducing any new OTP delivery channel
  - changing MFA factors or recovery pathways
  - authentication incident response activity

## Closure Criteria

- V6.6.1 row exists in launch evidence matrix and links this runbook.
- Code evidence proves PSTN OTP is not offered.
- Tests provide objective verification for reviewer replay.

## Reviewer Replay Command

- `npx vitest run --exclude ".next/**" "src/lib/auth-policy.test.ts" "src/app/api/auth/login/route.test.ts"`
