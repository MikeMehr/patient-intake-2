# Physical Safeguards

## Purpose

Define HIPAA physical safeguard controls for facilities, workstations, and media/devices used to operate `patient-intake-2`.

## Scope

- Workforce model: solo founder operation.
- Environments: any location/device used to access production PHI systems.
- Assets: laptops/workstations, removable media, backup artifacts, and printed materials.

## Control Objectives

1. Prevent unauthorized physical access to systems handling PHI.
2. Protect workstations/devices from unauthorized local access.
3. Control device/media handling, transport, and disposal.

## P-01 Facility Access and Workspace Security

- Production administration is performed from controlled workspaces.
- Physical entry to work area is restricted (locked premises/room when unattended).
- Device storage is controlled when not in use.
- Visitors and third parties do not receive unsupervised access to active PHI workstations.

Owner: Security/Operations  
Review frequency: Quarterly

## P-02 Workstation Security

- Endpoint full-disk encryption is required on production admin devices.
- Screen auto-lock and re-authentication are required after inactivity.
- Shared user accounts are prohibited for PHI administration devices.
- Endpoint login uses strong authentication with MFA-enabled identity providers where available.

Owner: Security/Operations  
Review frequency: Quarterly

## P-03 Device and Media Controls

- Approved-device inventory is maintained for systems used for PHI operations.
- Removable media use is restricted; if used for backups/exports, encryption is required.
- Printed PHI is minimized; any printed PHI is secured and disposed via shredding.
- Device retirement/disposal requires secure wipe/factory reset confirmation before transfer or destruction.

Owner: Security/Operations  
Review frequency: Quarterly

## Verification and Evidence

- Primary evidence artifact: `docs/compliance/evidence/physical-safeguards-attestation-2026-03-02.md`
- Related controls should be represented in:
  - `docs/compliance/launch-evidence-matrix.md`
  - `docs/compliance/master-security-control-inventory.md`
