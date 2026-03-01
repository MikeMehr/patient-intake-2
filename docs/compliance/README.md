# Compliance Documentation Index

This directory contains the detailed HIPAA launch compliance documentation for `patient-intake-2`.

## Documents

- `technical-safeguards.md`
  - Authentication, authorization, encryption, token handling, retention, headers, logging, and test gates.
- `operational-safeguards.md`
  - Monitoring, incident response, backup/DR, key management, access reviews, and release operations.
- `administrative-safeguards.md`
  - Training, sanctions policy, officer roles, policy governance, and workforce procedures.
- `vendor-baa-register.md`
  - Vendor inventory, PHI handling, BAA status, and review cadence.
- `launch-evidence-matrix.md`
  - Launch control-to-evidence mapping with owner, status, review date, and closure criteria.
- `release-candidate-go-no-go.md`
  - Final launch decision template with technical gate results and compliance sign-off fields.
- `runbooks/incident-response-and-breach-notification.md`
- `runbooks/access-provisioning-and-review-sop.md`
- `runbooks/backup-disaster-recovery-sop.md`
- `runbooks/key-management-and-rotation-sop.md`
- `runbooks/password-context-word-policy.md`
- `runbooks/credential-recovery-token-policy.md`
- `runbooks/oob-pstn-auth-policy.md`
- `runbooks/v6-authenticator-applicability-l2.md`

## Canonical References

- Root compliance summary: `SECURITY_HIPAA_COMPLIANCE_GUIDE.md`
- Risk acceptance record: `SECURITY_RISK_ACCEPTANCE_P0-4B.md`
- Engineering checklist: `HIPAA_READINESS_CHECKLIST.md`
- Prior implementation assessment: `HIPAA_IMPLEMENTATION_ASSESSMENT.md`

## Maintenance Rules

- Every control entry must include:
  - owner
  - current status
  - last review date
  - next review date
- Risk exceptions must include:
  - explicit expiration date
  - compensating controls
  - closure criteria
