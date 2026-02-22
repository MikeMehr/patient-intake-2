# Backup and Disaster Recovery SOP

## Purpose

Ensure recoverability of HIPAA-relevant systems and data with verified restore capability.

## Scope

- Datastores containing PHI and auth/audit metadata
- Application configuration and deployment assets

## Backup Controls

- Encrypted backups for all PHI-bearing systems.
- Backup frequency based on data criticality.
- Retention policy aligned with business and compliance requirements.

## Restore Testing

- Frequency: quarterly minimum, and before major release milestones.
- Test scenarios:
  - full environment restore
  - point-in-time restore
  - selective dataset restore
- Record:
  - start/end time
  - success/failure
  - data integrity checks
  - remediation actions

## RTO/RPO Targets

- Define service-level RTO and RPO.
- Validate restore outcomes against targets.

## DR Activation

1. Declare DR event and incident commander.
2. Restore prioritized services in sequence.
3. Verify integrity and access controls post-restore.
4. Resume operations and monitor.

## Required Evidence

- Backup configuration inventory
- Restore drill report
- RTO/RPO compliance report
- Post-drill corrective action tracking
