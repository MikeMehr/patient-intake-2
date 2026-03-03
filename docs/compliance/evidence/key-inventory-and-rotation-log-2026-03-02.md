# Key Inventory and Rotation Log

- Record date: 2026-03-02
- Owner: Manucher Mehraein (Security/Engineering)

## Key and Secret Inventory

- `SESSION_SECRET` (workforce session signing)
- `INVITATION_SESSION_SECRET` (invitation session signing)
- `PATIENT_PHI_ENCRYPTION_KEY` (PHI field encryption)
- `PATIENT_HIN_HASH_PEPPER` (HIN lookup hashing)
- `EMR_ENCRYPTION_KEY` (EMR credential encryption)
- Azure/OpenAI/Speech API credentials

## Rotation Cadence

- Session and signing secrets: every 90 days
- PHI encryption keys: every 180 days or on incident trigger
- API credentials: every 90 days or vendor-triggered rotation event

## Emergency Rotation Triggers

- Suspected credential compromise
- Unauthorized access event
- Break-glass usage
- Offboarding risk event

## Latest Rotation Event

- Rotation date: 2026-03-02
- Scope: launch-prep baseline rotation and validation
- Post-rotation verification: pass

## Approval

- Security approver: Manucher Mehraein
- Approval date: 2026-03-02
