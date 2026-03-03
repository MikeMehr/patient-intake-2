# Vendor BAA Execution Log

- Log date: 2026-03-02
- Owner: Manucher Mehraein

## Vendor Decisions

- Azure (hosting/infrastructure)
  - PHI touchpoint: yes
  - BAA required: yes
  - BAA status: executed
  - Evidence reference: contract record retained in legal archive

- Resend (email delivery)
  - PHI touchpoint in current production posture: no (HIPAA mode disables PHI-bearing email workflows)
  - BAA required: not required for current PHI-disabled path
  - BAA status: not_required_documented
  - Evidence reference: `docs/compliance/phi-production-scope.md`

- OpenAI / Google AI providers
  - PHI touchpoint in current production posture: no (external AI disabled for PHI mode)
  - BAA required: not required for current PHI-disabled path
  - BAA status: not_required_documented
  - Evidence reference: `docs/compliance/phi-production-scope.md`

## Control Note

Any change that enables PHI-bearing external AI or email paths must reopen vendor BAA review before production activation.

## Approval

- Legal/Compliance approver: Manucher Mehraein
- Approval date: 2026-03-02
