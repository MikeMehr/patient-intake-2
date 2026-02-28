# Authorization Matrix (ASVS V10.3.2)

This matrix defines expected authorization outcomes for high-risk API actions and links them to automated negative tests for role, object, and tenant boundaries.

## Matrix

| Surface | Action | Provider | Org Admin | Super Admin | Object Boundary | Tenant Boundary | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/patients/[patientId]` | Get patient chart | Allow own scope | Deny | Deny | Patient lookup is constrained by physician/org ownership predicate; out-of-scope returns `404` | Org boundary enforced in SQL filter using `organization_id` and `primary_physician_id` | `src/app/api/patients/[patientId]/route.ts`, `src/app/api/patients/[patientId]/route.test.ts` |
| `/api/admin/organizations/[id]` | Get/update/delete organization | Deny | Deny | Allow | Nonexistent org returns `404` for GET/PUT/DELETE | Cross-tenant access is intentionally allowed for super admins by design | `src/app/api/admin/organizations/[id]/route.ts`, `src/app/api/admin/organizations/[id]/route.test.ts` |
| `/api/physician/hpi-actions` | Generate HPI follow-up action | Allow own sessions only | Deny | Deny | Session owner check (`patientSession.physicianId === session.userId`); mismatch returns `403` | Provider ownership boundary enforced through session ownership | `src/app/api/physician/hpi-actions/route.ts`, `src/app/api/physician/hpi-actions/route.test.ts` |
| `/api/org/organization` | Get caller organization | Deny | Allow own org | Deny | Missing/deleted organization returns `404` | Caller must have `organizationId` in session; otherwise denied (`401`) | `src/app/api/org/organization/route.ts`, `src/app/api/org/organization/route.test.ts` |
| `/api/physician/transcription/draft` | Update SOAP draft | Allow own scope only | Deny | Deny | SOAP lookup constrained by workforce scope; out-of-scope returns `404` | Scope resolution enforces provider/org boundaries before update | `src/app/api/physician/transcription/draft/route.ts`, `src/app/api/physician/transcription/draft/route.test.ts` |

## Negative Test Coverage Added For V10.3.2

- Role boundary
  - Deny access for non-authorized roles on all five endpoints.
- Object boundary
  - Deny access to out-of-scope patient/session/SOAP records with non-disclosing status codes (`403`/`404`).
- Tenant boundary
  - Deny cross-tenant org/provider access where endpoint contract is tenant-scoped.

## Notes

- `404` is intentionally used for out-of-scope objects in several endpoints to minimize resource existence disclosure.
- `401` is intentionally used on org/super-admin guarded endpoints where role/session prerequisites are not met.
