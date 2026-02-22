# Key Management and Rotation SOP

## Purpose

Define secure lifecycle management for encryption keys and secrets used in HIPAA-relevant workflows.

## Scope

- App secrets (session/token secrets, API keys)
- Encryption keys used for PHI protection
- Access credentials for infrastructure and data stores

## Key Lifecycle

1. Generate keys in approved secure systems.
2. Store only in managed secret/key services.
3. Restrict access by least privilege.
4. Rotate on schedule and on compromise indicators.
5. Retire and revoke deprecated keys.

## Rotation Policy

- Routine rotation cadence by key class.
- Immediate rotation triggers:
  - suspected compromise
  - personnel/offboarding risk
  - incident-driven response

## Access Controls

- Separate duties for key usage and key administration.
- Approval workflow for privileged key access.
- Full audit logging on key operations.

## Break-Glass Procedure

- Time-boxed emergency access.
- Mandatory post-event review and key rotation.

## Required Evidence

- Key inventory with owner and purpose
- Rotation logs and dates
- Access approval logs
- Compromise-response records (if any)
