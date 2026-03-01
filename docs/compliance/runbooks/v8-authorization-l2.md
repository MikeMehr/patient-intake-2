# Authorization Policy (ASVS V8 L2)

## Purpose

Define the ASVS V8 authorization posture for the deployed workforce model and map applicable controls to objective implementation and verification evidence.

## Access Model In Scope

- Workforce roles: `provider`, `org_admin`, `super_admin`
- Resource boundaries:
  - role boundary (allowed actor types per endpoint)
  - object boundary (only permitted objects/records)
  - tenant boundary (cross-organization isolation)
- Scope resolver model:
  - provider-owned records and sessions
  - organization-scoped records for org admins
  - global scope only where explicitly intended for super admins

## V8 L2 Applicability Matrix

| Control | Applicability | Rationale | Primary evidence |
| --- | --- | --- | --- |
| `V8.1.2` | Applicable | Authorization rules are documented for role/object/tenant boundaries and mapped to route-level enforcement and tests. | `docs/compliance/authorization-matrix-v10.2.2.md`, `docs/compliance/authorization-matrix-v10.3.2.md` |
| `V8.2.3` | Applicable | Field/object access is explicitly restricted by role and scope checks with deny-path behavior. | `src/lib/session-access.ts`, `src/app/api/patients/[patientId]/route.ts`, `src/app/api/org/providers/[id]/route.ts` |
| `V8.4.1` | Applicable | Multi-tenant boundaries are enforced through organization-scoped predicates and ownership checks. | `src/app/api/sessions/list/route.ts`, `src/app/api/prescriptions/fax/route.ts`, `src/app/api/lab-requisitions/editor-session/route.ts` |

## Policy Requirements

1. **Role enforcement**
   - Protected routes must verify user authentication and allowed role(s) before data access.
   - Unauthorized role access must fail closed.

2. **Object-level boundary enforcement**
   - Access to per-session/per-patient/per-document resources must verify ownership or approved scope before reads/writes.
   - Out-of-scope objects should use non-disclosing failure behavior (`403` or `404`) per endpoint contract.

3. **Tenant boundary enforcement**
   - Cross-organization access must be denied for provider and org-admin scoped routes.
   - Any super-admin global surface must be explicit and documented as global by design.

4. **Evidence completeness**
   - Each high-risk authorization surface must map to at least one negative test for role/object/tenant boundary behavior.

## Implementation Evidence

- Authorization/session primitives:
  - `src/lib/auth.ts`
  - `src/lib/session-access.ts`
  - `src/lib/transcription-store.ts`
- Route-level enforcement examples:
  - `src/app/api/patients/[patientId]/route.ts`
  - `src/app/api/org/providers/[id]/route.ts`
  - `src/app/api/prescriptions/fax/route.ts`
  - `src/app/api/lab-requisitions/generate/route.ts`
  - `src/app/api/lab-requisitions/editor-session/route.ts`
  - `src/app/api/physician/translate-final-comments/route.ts`

## Verification Evidence

- Authorization matrix mappings:
  - `docs/compliance/authorization-matrix-v10.2.2.md`
  - `docs/compliance/authorization-matrix-v10.3.2.md`
- Route-level role/object/tenant negative tests:
  - `src/app/api/org/providers/[id]/route.test.ts`
  - `src/app/api/patients/[patientId]/route.test.ts`
  - `src/app/api/sessions/list/route.test.ts`
  - `src/app/api/prescriptions/fax/route.test.ts`
  - `src/app/api/lab-requisitions/generate/route.test.ts`
  - `src/app/api/lab-requisitions/editor-session/route.test.ts`
  - `src/app/api/physician/translate-final-comments/route.test.ts`

## Non-Applicable Rationale

- No non-applicable V8 controls are currently claimed in this runbook. If new V8 controls are added to scope later, applicability will be recorded explicitly before attestation updates.

## Governance

- Control owner: Security + Engineering
- Policy approver: Security lead
- Last review: 2026-03-01
- Next review: 2026-04-01
- Review cadence: monthly and after authorization model changes

## Reviewer Replay Command

- `npx vitest run --exclude ".next/**" "src/app/api/org/providers/[id]/route.test.ts" "src/app/api/patients/[patientId]/route.test.ts" "src/app/api/sessions/list/route.test.ts" "src/app/api/prescriptions/fax/route.test.ts" "src/app/api/lab-requisitions/generate/route.test.ts" "src/app/api/lab-requisitions/editor-session/route.test.ts" "src/app/api/physician/translate-final-comments/route.test.ts"`
