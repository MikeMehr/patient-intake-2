# Password Policy

## Purpose

Define the password requirements enforced for all workforce accounts (super admin,
org admin, provider) in HealthAssist AI, and map each requirement to its
implementation evidence and applicable ASVS control.

## Scope

- Workforce account creation (registration)
- Password reset (credential recovery flow)
- Admin-initiated and org-initiated password updates for providers and org users

Patient-facing flows that do not use passwords (invitation OTP) are out of scope
for this policy.

## Password Requirements

### 1. Minimum length

Passwords must be at least **8 characters** long.

- Implementation: `src/lib/auth.ts` → `validatePassword()`
- ASVS reference: V6.1.1

### 2. Character class requirement

Passwords must contain at least one **letter** (a–z or A–Z) and at least one
**digit** (0–9).

These are the minimum enforced constraints. Users are encouraged to choose longer,
more varied passphrases; no maximum length is imposed.

- Implementation: `src/lib/auth.ts` → `validatePassword()`
- ASVS reference: V6.1.1

### 3. Context-specific word prohibition

Passwords may not contain organization names, product identifiers, environment
tags, or role words that make them trivially guessable. Comparison is
leet-speak–normalized and case-insensitive.

Prohibited word categories (illustrative; see `src/lib/password-context.ts`):
- Organization and brand names: `health-assist`, `healthassist`, `mymd`, `healthassistai`
- Role words: `admin`, `provider`, `doctor`, `physician`, `support`
- Environment tags: `prod`, `staging`, `dev`
- Additional words configurable via `PASSWORD_CONTEXT_WORDS` environment variable

Full governance details: `docs/compliance/runbooks/password-context-word-policy.md`

- Implementation: `src/lib/password-context.ts` → `isPasswordContextWordSafe()`
- Enforcement points: registration, reset, admin/org password update routes
- ASVS reference: V6.1.2

### 4. Compromised-password check (HIBP)

Passwords are checked against the Have I Been Pwned (HIBP) Pwned Passwords
database using the k-anonymity range API. Only the first 5 hex characters of the
SHA-1 hash are transmitted; the full hash never leaves the server.

Behavior:
- If the password appears in a known breach, registration/reset is rejected.
- If the HIBP service is unavailable: default behavior is **fail-closed**
  (reject the request). This can be relaxed to fail-open via
  `PASSWORD_BREACH_FAIL_OPEN=true` in environments where service availability is
  prioritized over breach-check strictness.
- HIBP range responses are cached in-process for up to 10 minutes
  (configurable via `PASSWORD_BREACH_CACHE_TTL_MS`).

- Implementation: `src/lib/password-breach.ts` → `assessPasswordAgainstBreaches()`
- ASVS reference: V6.1.3 (known-breached password check)

## Password Storage

Passwords are hashed with **bcrypt** at a cost factor of **12** before storage.
Plaintext passwords are never logged or persisted.

- Implementation: `src/lib/auth.ts` → `hashPassword()`, `verifyPassword()`
- ASVS reference: V6.2.1

## Enforcement Points

| Flow | Context-word check | Breach check | Length + class check |
| --- | --- | --- | --- |
| Registration | yes | yes | yes |
| Password reset | yes | yes | yes |
| Admin provider password update | yes | yes | yes |
| Org provider password update | yes | yes | yes |

All three checks are applied before the password is hashed or stored.

## Validation Error Messages

Validation errors use minimal disclosure:
- Length: "Password must be at least 8 characters"
- Character class (letter): "Password must contain at least one letter"
- Character class (digit): "Password must contain at least one number"
- Context word: "Password contains organization or system words and is too easy to guess."
- Breached: "This password has been exposed in known data breaches. Please choose a different password."
- Breach check unavailable (fail-closed): "Password security check is temporarily unavailable. Please try again in a few minutes."

## ASVS Control Mapping Summary

| ASVS ID | Requirement | Status | Implementation |
| --- | --- | --- | --- |
| V6.1.1 | Minimum length and basic character class | implemented | `src/lib/auth.ts` → `validatePassword()` |
| V6.1.2 | Context-specific word prohibition | implemented | `src/lib/password-context.ts` |
| V6.1.3 | Breach check against known compromised passwords | implemented | `src/lib/password-breach.ts` |
| V6.2.1 | Passwords stored using adaptive one-way hash | implemented | `src/lib/auth.ts` → bcrypt(12) |

## Governance

- Control owner: Security + Engineering
- Policy approver: Manucher Mehraein
- Last review: 2026-03-13
- Next review: 2026-04-13
- Review cadence: monthly, and immediately after any change to password validation logic

## Change Control

1. Engineering proposes changes to password requirements.
2. Security reviews for ASVS compliance impact.
3. Changes are reviewed in PR with security reviewer and tests updated.
4. Evidence links are updated in `docs/compliance/launch-evidence-matrix.md`.
5. Changes are communicated to affected teams.

## Implementation Evidence

- `src/lib/auth.ts` — `validatePassword()`, `hashPassword()`, `verifyPassword()`
- `src/lib/password-context.ts` — `isPasswordContextWordSafe()`
- `src/lib/password-breach.ts` — `assessPasswordAgainstBreaches()`
- `src/app/api/auth/register/route.ts`
- `src/app/api/auth/reset-password/[token]/route.ts`
- `src/app/api/admin/providers/[id]/route.ts`
- `src/app/api/org/providers/[id]/route.ts`

## Verification Evidence

- `src/lib/auth.test.ts`
- `src/lib/password-context.test.ts`
- `src/lib/password-breach.test.ts` (if present)
- `src/app/api/auth/register/route.test.ts`
- `src/app/api/auth/reset-password/[token]/route.test.ts`
- `src/app/api/admin/providers/[id]/route.test.ts`
- `src/app/api/org/providers/[id]/route.test.ts`

## Reviewer Replay Command

```
npx vitest run --exclude ".next/**" \
  "src/lib/auth.test.ts" \
  "src/lib/password-context.test.ts" \
  "src/app/api/auth/register/route.test.ts" \
  "src/app/api/auth/reset-password/[token]/route.test.ts" \
  "src/app/api/admin/providers/[id]/route.test.ts" \
  "src/app/api/org/providers/[id]/route.test.ts"
```
