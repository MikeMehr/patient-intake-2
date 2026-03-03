# Azure Runtime Security Attestation

- Attestation date: 2026-03-02
- System: `patient-intake-2`
- Attestor: Manucher Mehraein
- Role: Security/Operations

## Purpose

Provide deployment-time attestation that Azure/runtime dependency controls documented in `DEPLOYMENT.md` are configured for PHI launch posture.

## Controls Attested

### AZ-01 Private Network Posture

- Azure OpenAI endpoint is configured for private-network usage expectations.
- Database/storage services are expected to use private endpoint access patterns.
- Public network exposure is restricted according to deployment policy.

Status: implemented_attested

### AZ-02 App Network Integration and Egress Restriction

- Application runtime is configured to use private network routing for PHI dependencies.
- Outbound egress is restricted to required services and approved destinations.

Status: implemented_attested

### AZ-03 TLS and Secrets Hardening

- TLS is enforced for external and service connectivity.
- Secrets are stored in managed secret stores/CI secret systems (not in source control).
- `SESSION_SECRET` and other production secrets are set as runtime configuration values.

Status: implemented_attested

## Verification Method

- Configuration review against:
  - `DEPLOYMENT.md` Network Isolation Checklist (Azure)
  - runtime environment configuration checklist in `docs/compliance/release-candidate-go-no-go.md`
- Deployment verification performed during release hardening.

## Evidence Boundary Note

This repository does not currently include IaC definitions (Terraform/Bicep/ARM) for these controls. Evidence is attestation-based and must be revalidated each review cycle.

## Review Cadence

- Monthly review and on any infrastructure topology change.

## Approval

- Approver: Manucher Mehraein
- Date: 2026-03-02
