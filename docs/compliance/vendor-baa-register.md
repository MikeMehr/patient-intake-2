# Vendor BAA Register

Use this register to track all vendors that may process PHI.

## Current Register

- Vendor: Azure (hosting/infrastructure)
  - PHI touchpoint: application hosting, database/storage, networking
  - BAA required: yes
  - BAA status: pending_execution
  - Owner: Security/Legal
  - Next review: TODO (date)
  - Evidence link: TODO
  - Approver: TODO

- Vendor: Resend (email delivery)
  - PHI touchpoint: invitation workflow metadata/email routing
  - BAA required: yes if PHI-bearing use
  - BAA status: pending_execution
  - Owner: Security/Legal
  - Next review: TODO (date)
  - Evidence link: TODO
  - Approver: TODO

- Vendor: OpenAI / Google AI providers
  - PHI touchpoint: model-assisted workflow paths
  - BAA required: yes when PHI may be transmitted
  - BAA status: pending_execution
  - Owner: Security/Legal/Engineering
  - Next review: TODO (date)
  - Evidence link: TODO
  - Approver: TODO

## Register Rules

- No PHI workflow may go live with a vendor marked BAA status != executed.
- Any vendor lacking required BAA must be technically disabled for PHI data paths.

## Allowed BAA Status Values

- pending_execution
- in_legal_review
- executed
- not_required_documented
