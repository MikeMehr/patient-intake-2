# Authorization Matrix (ASVS V10.2.2)

This matrix defines expected authorization outcomes for high-risk API actions and links them to automated negative tests covering role, object, and tenant boundaries.

## Matrix

| Surface | Action | Provider | Org Admin | Super Admin | Object Boundary | Tenant Boundary | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/invitations/list` | List invitation records | Allow own scope | Deny | Deny | Provider-scoped by `physician_id` | N/A | `src/app/api/invitations/list/route.ts`, `src/app/api/invitations/list/route.test.ts` |
| `/api/invitations/[invitationId]` | Delete invitation | Allow own scope | Deny | Deny | Deny delete when invitation is not owned (404) | N/A | `src/app/api/invitations/[invitationId]/route.ts`, `src/app/api/invitations/[invitationId]/route.test.ts` |
| `/api/org/providers/[id]` | Update provider | Deny | Allow in-org only | Deny | Deny when provider id outside org scope (404) | Enforced by `organization_id` filter | `src/app/api/org/providers/[id]/route.ts`, `src/app/api/org/providers/[id]/route.test.ts` |
| `/api/sessions/list` | List patient sessions | Allow provider scope | Allow org scope | Deny | Scoped by viewer/session scope resolution | Org scope enforced for org admins | `src/app/api/sessions/list/route.ts`, `src/app/api/sessions/list/route.test.ts` |
| `/api/admin/providers/[id]` | Update provider | Deny | Deny | Allow | Provider existence checks before update | Cross-tenant permitted by design for super admin | `src/app/api/admin/providers/[id]/route.ts`, `src/app/api/admin/providers/[id]/route.test.ts` |

## Negative Test Coverage Added For V10.2.2

- **Role boundary**
  - Non-provider users denied on invitation listing/deletion.
  - Non-org-admin users denied on org provider update.
- **Object boundary**
  - Provider cannot delete another provider's invitation (`404`).
- **Tenant boundary**
  - Org admin cannot update provider from another organization (`404`).

## Notes

- `404` is intentionally used for out-of-scope object/tenant access where existence disclosure should be minimized.
- Super-admin endpoints are intentionally global by design and validated separately via role-gating tests.
