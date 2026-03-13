# Vendor BAA Execution Log

- Log date: 2026-03-02
- Owner: Manucher Mehraein
- Correction applied: 2026-03-13 — Microsoft Azure BAA status updated to reflect
  actual mechanism (DPA / Product Terms, not a separately signed document)

## Vendor Decisions

- Microsoft Azure (hosting/infrastructure/AI/speech)
  - PHI touchpoint: yes
  - BAA required: yes
  - BAA status: covered_via_product_terms
  - Mechanism: Microsoft includes HIPAA BAA coverage in its standard Data Processing
    Addendum (DPA) / Product Terms. Coverage is established at subscription time;
    no separately signed bilateral document is issued.
  - Evidence reference: `docs/compliance/evidence/microsoft-dpa-baa-reference-2026-03-13.md`
  - In-scope services: Azure App Service, Azure PostgreSQL, Azure VNet, Azure OpenAI,
    Azure AI Speech (STT/TTS), Azure AI Document Intelligence, Azure Application Insights

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
