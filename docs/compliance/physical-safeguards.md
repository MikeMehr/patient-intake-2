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

## P-04 Endpoint Malware Protection

- Developer endpoints run macOS, which includes Apple XProtect (signature-based malware
  scanner), Gatekeeper (blocks unsigned/unnotarized executables), and MRT (Malware Removal
  Tool). These controls are enabled by default and updated automatically via macOS system
  updates.
- No third-party antivirus product is additionally installed; macOS native controls are
  the primary endpoint malware defense.
- Production environment (Azure App Service) does not run persistent user-controlled
  processes or accept file uploads in HIPAA mode. The file upload endpoint returns HTTP 503
  when `HIPAA_MODE=true`, eliminating the primary server-side malware ingestion pathway.
  This fail-closed design is the compensating control for server-side AV absence.
- Developer endpoints must not have XProtect, Gatekeeper, or automatic macOS security
  updates disabled.
- Any future enablement of file uploads in production must include server-side malware
  scanning (e.g., Azure Defender for Storage or equivalent) before activation.

Owner: Security/Operations
Review frequency: Quarterly

## Verification and Evidence

- Primary evidence artifact: `docs/compliance/evidence/physical-safeguards-attestation-2026-03-02.md`
- Endpoint malware protection attestation: `docs/compliance/evidence/endpoint-malware-protection-attestation-2026-03-30.md`
- Related controls should be represented in:
  - `docs/compliance/launch-evidence-matrix.md`
  - `docs/compliance/master-security-control-inventory.md`
