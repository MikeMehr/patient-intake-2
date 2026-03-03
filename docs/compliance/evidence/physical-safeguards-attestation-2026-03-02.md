# Physical Safeguards Attestation

- Attestation date: 2026-03-02
- System: `patient-intake-2`
- Attestor: Manucher Mehraein
- Role: Security/Operations

## Scope

This attestation covers physical safeguards used for production administration activities and PHI-relevant operations.

## Control Verification

### P-01 Facility Access and Workspace Security

- Controlled workspace used for production administration.
- Premises/work area is locked or otherwise access-restricted when unattended.
- Devices are stored securely when not in active use.
- Unsupervised third-party access to active PHI workstations is not permitted.

Status: implemented

### P-02 Workstation Security

- Primary administration endpoint uses full-disk encryption.
- Screen lock with re-authentication is enabled.
- Shared accounts are not used for production administration.
- MFA is required for privileged cloud/admin identities.

Status: implemented

### P-03 Device and Media Controls

- Production administration devices are inventoried.
- Removable media use is restricted; encryption is required when media is used.
- Printed PHI handling is minimized and secured; disposal follows shredding/safe-destruction practice.
- Device retirement/disposal follows secure wipe/reset procedure.

Status: implemented

## Review Cadence

- Quarterly review or upon material change to workspace/device model.

## Approval

- Approver: Manucher Mehraein
- Date: 2026-03-02
