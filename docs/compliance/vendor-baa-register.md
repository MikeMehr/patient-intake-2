# Vendor BAA Register

Use this register to track all vendors that may process PHI.

## Current Register

- Vendor: Azure (hosting/infrastructure)
  - PHI touchpoint: application hosting, database/storage, networking
  - BAA required: yes
  - BAA status: executed
  - Owner: Security/Legal
  - Last reviewed: 2026-03-13
  - Next review: 2026-06-02
  - Evidence link: `docs/compliance/evidence/baa-execution-log-2026-03-02.md`, `docs/compliance/evidence/baa-review-2026-03-13.md`
  - Approver: Manucher Mehraein

- Vendor: Resend (email delivery)
  - PHI touchpoint: PHI-bearing email path disabled in HIPAA production mode
  - BAA required: no for current PHI-disabled use
  - BAA status: not_required_documented
  - Owner: Security/Legal
  - Last reviewed: 2026-03-13
  - Next review: 2026-06-02
  - Evidence link: `docs/compliance/evidence/baa-execution-log-2026-03-02.md`, `docs/compliance/evidence/baa-review-2026-03-13.md`
  - Approver: Manucher Mehraein

- Vendor: OpenAI / Google AI providers
  - PHI touchpoint: external AI PHI paths disabled in HIPAA production mode
  - BAA required: no for current PHI-disabled use
  - BAA status: not_required_documented
  - Owner: Security/Legal/Engineering
  - Last reviewed: 2026-03-13
  - Next review: 2026-06-02
  - Evidence link: `docs/compliance/evidence/baa-execution-log-2026-03-02.md`, `docs/compliance/evidence/baa-review-2026-03-13.md`
  - Approver: Manucher Mehraein

## Register Rules

- No PHI workflow may go live with a vendor marked BAA status != executed.
- Any vendor lacking required BAA must be technically disabled for PHI data paths.

## Allowed BAA Status Values

- pending_execution
- in_legal_review
- executed
- not_required_documented
