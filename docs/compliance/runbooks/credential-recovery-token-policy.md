# Credential Recovery Token Policy (ASVS V6.3.4)

## Purpose

Define required controls for credential recovery token issuance and consumption so password reset flows cannot be replayed, repurposed, or used outside their intended context.

## Scope

- Password reset request flow (`POST /api/auth/reset-password`)
- Password reset token consume flow (`POST /api/auth/reset-password/[token]`)
- Recovery token storage, claim validation, and token lifecycle handling

## Control Mapping

- ASVS control: `V6.3.4`
- Related controls:
  - `V6.4.3` (MFA continuity during password reset)
  - `V10.1.1` (token claim integrity at rest and verification)

## Policy Requirements

Credential recovery tokens must be implemented with all of the following:

1. **Single-use enforcement**
   - A token must be marked consumed immediately after successful password reset.
   - New reset requests must invalidate previously active reset tokens for the account.

2. **Expiry enforcement**
   - Tokens must have explicit expiration and be rejected once expired.

3. **Context-bound validation**
   - Token verification must enforce expected issuer, audience, token type, and token context claims.
   - Tokens with mismatched claims must be rejected.

4. **Replay resistance**
   - Unknown, previously used, expired, or claim-mismatched tokens must fail closed.

5. **Abuse resistance**
   - Reset request and reset consume paths must be rate limited.

6. **Session invalidation after reset**
   - Successful password reset must revoke existing active sessions for the account.

## Implementation Evidence

- Token issuance and invalidation:
  - `src/app/api/auth/reset-password/route.ts`
- Token consumption and claim/context enforcement:
  - `src/app/api/auth/reset-password/[token]/route.ts`
- Shared expected claim source:
  - `src/lib/token-claims.ts`
- Schema support for claim-bound token verification:
  - `src/lib/migrations/028_add_token_claim_columns.sql`

## Verification Evidence

- Reset request stores hashed token + claim metadata:
  - `src/app/api/auth/reset-password/route.test.ts`
- Reset consume path enforces claim checks, rejects replay/expired tokens, and marks token used:
  - `src/app/api/auth/reset-password/[token]/route.test.ts`

## Governance

- Control owner: Security + Engineering
- Policy approver: Security lead (Compliance reviewer for launch evidence updates)
- Last review: 2026-02-27
- Next review: 2026-03-27
- Review cadence: monthly, and immediately after:
  - token model changes
  - reset-flow architecture changes
  - security incidents affecting account recovery

## Change Control Procedure

1. Security and Engineering propose recovery-flow control updates.
2. Engineering updates implementation and tests in the same change set.
3. Security reviews claim and replay protections before merge.
4. Evidence links are updated in `docs/compliance/launch-evidence-matrix.md`.
5. Compliance sign-off is recorded in launch readiness artifacts.

## Required Evidence for Audit

- Current version of this policy with owner and review dates
- Linked implementation references for issuance, validation, and invalidation paths
- Automated tests proving claim enforcement, expiry handling, and replay rejection
- Evidence matrix entry showing closure criteria and current control status
