# Session Management Policy (ASVS V7 L2)

## Purpose

Define the ASVS V7 session-management posture for the deployed workforce authentication model and provide objective evidence mappings for all applicable controls.

## Authentication Model In Scope

- Workforce accounts: `super_admin`, `org_admin`, `provider`
- Session mechanism: server-side session rows in `physician_sessions` + `physician_session` HTTP-only cookie
- Factors in scope: password + optional email OTP MFA and backup-code recovery
- Federated SSO/IdP session federation: not implemented

## V7 L2 Applicability Matrix

- `V7.1.1` - applicable
- `V7.1.2` - applicable
- `V7.1.3` - non-applicable (no federated identity/session ecosystem)
- `V7.3.1` - applicable
- `V7.3.2` - applicable
- `V7.4.3` - applicable
- `V7.4.4` - applicable
- `V7.4.5` - applicable
- `V7.5.1` - non-applicable (no self-service endpoint that lets users mutate their own auth factors/attributes)
- `V7.5.2` - non-applicable (no self-service "active session inventory" UX in current workforce model)
- `V7.6.1` - non-applicable (no relying-party / IdP federation flow)
- `V7.6.2` - applicable

## Policy Requirements (Applicable Controls)

1. **Documented idle and absolute lifetimes (`V7.1.1`, `V7.3.1`, `V7.3.2`)**
   - Idle timeout is 30 minutes.
   - Absolute maximum lifetime is 4 hours from initial session creation.
   - Both are enforced server-side using DB-backed timestamps.

2. **Documented parallel-session behavior (`V7.1.2`)**
   - Maximum concurrent sessions per workforce account is 3.
   - On a successful new login session creation, oldest active sessions for that account are evicted first.

3. **Session rotation and anti-fixation (`V7.6.2`)**
   - Session token is rotated on successful refresh (`/api/auth/ping`).
   - Rotation stores a short grace window for prior token acceptance to avoid in-flight request breakage.

4. **Termination controls (`V7.4.3`, `V7.4.4`, `V7.4.5`)**
   - Logout endpoint invalidates server session and clears cookie.
   - Password reset / password update paths revoke existing sessions for the affected account.
   - Administrators can terminate sessions:
     - super admin: per-user or global workforce sessions
     - org admin: per-user (in-org) or full organization session set
   - Dashboard pages provide visible sign-out actions for workforce roles.

## Implementation Evidence

- Core session policy and enforcement:
  - `src/lib/auth.ts`
- Refresh endpoint (controlled idle refresh + rotation):
  - `src/app/api/auth/ping/route.ts`
- Logout endpoint:
  - `src/app/api/auth/logout/route.ts`
- Password-change reset revocation:
  - `src/app/api/auth/reset-password/[token]/route.ts`
  - `src/app/api/admin/providers/[id]/route.ts`
  - `src/app/api/org/providers/[id]/route.ts`
- Administrative termination endpoints:
  - `src/app/api/admin/sessions/terminate/route.ts`
  - `src/app/api/org/sessions/terminate/route.ts`
- Visible sign-out UX:
  - `src/app/admin/dashboard/page.tsx`
  - `src/app/org/dashboard/page.tsx`
  - `src/app/physician/dashboard/page.tsx`

## Verification Evidence

- Core timeout/rotation lifecycle tests:
  - `src/lib/auth.test.ts`
- Refresh route behavior:
  - `src/app/api/auth/ping/route.test.ts`
- Logout route behavior:
  - `src/app/api/auth/logout/route.test.ts`
- Credential-change session revocation:
  - `src/app/api/auth/reset-password/[token]/route.test.ts`
  - `src/app/api/admin/providers/[id]/route.test.ts`
  - `src/app/api/org/providers/[id]/route.test.ts`
- Admin termination endpoint behavior:
  - `src/app/api/admin/sessions/terminate/route.test.ts`
  - `src/app/api/org/sessions/terminate/route.test.ts`

## Non-Applicable Rationale

- `V7.1.3` and `V7.6.1`: federation controls are out of scope because there is no SSO/OIDC/SAML IdP-RP session chain in this deployment.
- `V7.5.1`: current workforce product does not expose self-service endpoints for a user to modify their own authentication factors/attributes while authenticated; those changes occur in dedicated recovery/admin workflows with separate controls.
- `V7.5.2`: current workforce model does not expose end-user session inventory/termination UX; compensating controls are short idle/absolute lifetimes, refresh-time rotation, explicit logout, password-change revocation, and administrator-driven session termination APIs.

## Governance

- Control owner: Security + Engineering
- Policy approver: Security lead
- Last review: 2026-03-01
- Next review: 2026-04-01
- Review cadence: monthly and after any auth/session architecture change

## Reviewer Replay Command

- `npx vitest run --exclude ".next/**" "src/lib/auth.test.ts" "src/app/api/auth/ping/route.test.ts" "src/app/api/auth/logout/route.test.ts" "src/app/api/auth/reset-password/[token]/route.test.ts" "src/app/api/admin/providers/[id]/route.test.ts" "src/app/api/org/providers/[id]/route.test.ts" "src/app/api/admin/sessions/terminate/route.test.ts" "src/app/api/org/sessions/terminate/route.test.ts"`
