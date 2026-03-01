# Self-Contained Token Policy (ASVS V9 L2)

## Purpose

Define ASVS V9 Level 2 controls applicable to this build and map token protections to implementation and automated verification evidence.

## Token Model In Scope

- Signed invitation verified-session cookie payloads
- Password reset tokens (stored and validated with explicit claim binding)
- MFA challenge/recovery tokens with purpose + context binding
- OSCAR OAuth request tokens for EMR callback handoff

## V9 L2 Applicability Matrix

| Control | Applicability | Rationale | Primary evidence |
| --- | --- | --- | --- |
| `V9.2.2` | Applicable | Services must validate token type/purpose before accepting claims. | `src/lib/token-claims.ts`, reset/invitation/MFA/OSCAR token routes |
| `V9.2.3` | Applicable | Token audience must match the intended service audience. | `src/lib/token-claims.ts`, claim-bound token queries |
| `V9.2.4` | Applicable | Token issuer and audience restrictions prevent token reuse across unintended services/flows. | reset/invitation/MFA/OSCAR claim checks and tests |

## Policy Requirements

1. **Type + purpose validation (`V9.2.2`)**
   - Each token acceptance path must enforce expected `type` and `context`.
   - Tokens from a different flow are rejected.

2. **Audience restriction (`V9.2.3`)**
   - Each token acceptance path must enforce expected `aud`.
   - Audience mismatch is rejected before privileged actions.

3. **Issuer + replay-bound validation (`V9.2.4`)**
   - Each acceptance path must enforce expected `iss`.
   - Tokens are single-use or short-lived where applicable and denied when replayed/expired.

4. **Tamper resistance**
   - Signed client-carried token payloads (invitation session cookie) must fail closed when signature or payload integrity is altered.

## Implementation Evidence

- Shared claim model:
  - `src/lib/token-claims.ts`
- Password reset claim-bound issuance/consume:
  - `src/app/api/auth/reset-password/route.ts`
  - `src/app/api/auth/reset-password/[token]/route.ts`
- MFA claim and context enforcement:
  - `src/lib/auth-mfa.ts`
  - `src/app/api/auth/login/mfa/verify/route.ts`
  - `src/app/api/auth/login/mfa/recovery/route.ts`
- Invitation session claim + signature validation:
  - `src/lib/invitation-security.ts`
- OSCAR request token claim-bound callback:
  - `src/app/api/admin/organizations/[id]/emr/oscar/connect/route.ts`
  - `src/app/api/admin/emr/oscar/callback/route.ts`

## Verification Evidence

- Reset token claim checks and replay rejection:
  - `src/app/api/auth/reset-password/[token]/route.test.ts`
  - `src/app/api/auth/reset-password/route.test.ts`
- MFA token claim/type/context deny paths:
  - `src/lib/auth-mfa.test.ts`
  - `src/app/api/auth/login/mfa/verify/route.test.ts`
  - `src/app/api/auth/login/mfa/recovery/route.test.ts`
- Invitation token claim/signature tamper deny paths:
  - `src/lib/invitation-security.test.ts`
- OSCAR callback token claim binding:
  - `src/app/api/admin/organizations/[id]/emr/oscar/connect/route.test.ts`
  - `src/app/api/admin/emr/oscar/callback/route.test.ts`

## Non-Applicable Rationale

- No additional V9 non-applicable L2 rows are asserted in this runbook. If new V9 controls are introduced in the assessment sheet, applicability and rationale are documented before status updates.

## Governance

- Control owner: Security + Engineering
- Policy approver: Security lead
- Last review: 2026-03-01
- Next review: 2026-04-01
- Review cadence: monthly and after token model changes

## Reviewer Replay Command

- `npx vitest run --exclude ".next/**" "src/app/api/auth/reset-password/route.test.ts" "src/app/api/auth/reset-password/[token]/route.test.ts" "src/lib/auth-mfa.test.ts" "src/app/api/auth/login/mfa/verify/route.test.ts" "src/app/api/auth/login/mfa/recovery/route.test.ts" "src/lib/invitation-security.test.ts" "src/app/api/admin/organizations/[id]/emr/oscar/connect/route.test.ts" "src/app/api/admin/emr/oscar/callback/route.test.ts"`
