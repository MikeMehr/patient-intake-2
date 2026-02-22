# Access Provisioning and Review SOP

## Purpose

Define controlled workforce access lifecycle for HIPAA-relevant systems.

## Scope

- User roles: super admin, org admin, provider, operations/support
- Systems: app access, infrastructure access, secrets manager, CI/CD, database access

## Provisioning Process

1. Access request submitted by manager with business justification.
2. Role mapped to least-privilege template.
3. Security/compliance approval recorded.
4. Access granted with MFA requirement where applicable.
5. User receives training and policy acknowledgment.

## Role Rules

- Production PHI access requires explicit role assignment and manager approval.
- Privileged roles require elevated approval and periodic review.
- Shared accounts are prohibited.

## Joiner-Mover-Leaver

- Joiner: grant minimum role set.
- Mover: remove old role grants before adding new ones.
- Leaver: revoke all access within same business day.

## Periodic Access Reviews

- Frequency: monthly for privileged roles, quarterly for standard PHI roles.
- Reviewer: security + functional manager.
- Output:
  - approved retained access
  - revoked access
  - exceptions with expiration date

## Emergency Access

- Time-bound emergency grants with automatic expiry.
- Mandatory retrospective review within 2 business days.

## Required Records

- Access request and approval logs
- Access review reports
- Revocation evidence
- Exceptions register with owner and expiry
