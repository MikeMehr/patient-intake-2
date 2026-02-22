# Operational Safeguards

## Monitoring and Alerting

- Monitor authentication anomalies:
  - repeated failed login attempts
  - repeated reset-token failures
- Monitor PHI access patterns:
  - unusual volume of reads/exports
  - cross-role access denials
- Monitor platform reliability:
  - sustained 5xx rates
  - failed cleanup/maintenance jobs

## Incident Response

- Maintain an incident response runbook with:
  - detection and triage
  - containment
  - eradication and recovery
  - post-incident review
- Include breach notification procedure and regulatory timeline checks.

## Access Operations

- Enforce joiner/mover/leaver workflow for workforce access.
- Perform periodic access reviews for privileged roles.
- Track emergency access grants and revocations.

## Key and Secret Management

- Keep secrets in managed secret storage, not source control.
- Define key rotation cadence and emergency rotation procedure.
- Restrict key access by least privilege and approval workflow.

## Backup and Disaster Recovery

- Ensure encrypted backups for PHI-bearing stores.
- Document retention windows and restore procedure.
- Run periodic restoration tests and capture evidence.
- Maintain RTO/RPO expectations and ownership.

## Release Process Controls

- Build and deploy from protected branches.
- Use lockfile-based installs in CI (`npm ci`).
- Enforce runtime vulnerability gate in CI before deploy.
- Capture release evidence for each launch candidate.
