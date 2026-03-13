# Vendor BAA Review — Week 2

- Review date: 2026-03-13
- Reviewer: Manucher Mehraein
- Cadence: Weekly during initial compliance period, then per register schedule

## Review Scope

This review confirms no changes to the BAA register since the initial execution log (2026-03-02)
and verifies no new vendors have been introduced that require BAA assessment.

## Vendor Status Confirmation

- Azure (hosting/infrastructure)
  - PHI touchpoint: yes — application hosting, database, networking
  - BAA status: executed — no change
  - Notes: BAA in place. Next scheduled review: 2026-06-02.

- Resend (email delivery)
  - PHI touchpoint: no — PHI-bearing email paths remain disabled in HIPAA production mode
  - BAA status: not_required_documented — no change
  - Notes: Resend is not processing PHI in current production posture (`HIPAA_MODE=true`).
    If PHI email paths are ever enabled, this must be reopened before activation.

- OpenAI / Google AI providers
  - PHI touchpoint: no — external AI disabled for PHI mode
  - BAA status: not_required_documented — no change
  - Notes: All external AI routes return 503 in `HIPAA_MODE=true`. No PHI transits
    these providers in current production posture. Must reopen if PHI paths are enabled.

## New Vendor Assessment

No new third-party vendors or integrations were introduced between 2026-03-02 and 2026-03-13
that require BAA evaluation.

## File Upload Security Note

The `analyze-lesion` image upload endpoint is disabled (`503`) in `HIPAA_MODE=true`.
No uploaded image data reaches external AI providers in the current production posture.
See `docs/compliance/runbooks/file-upload-security.md` for the upload control inventory.

## Control Note

The rule in `docs/compliance/vendor-baa-register.md` remains in effect: no PHI workflow may
go live with a vendor whose BAA status is not `executed`. Current register is compliant.

## Approval

- Reviewer: Manucher Mehraein
- Review date: 2026-03-13
- Next scheduled review: 2026-06-02 (per register cadence)
