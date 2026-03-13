# Vendor BAA Register

Use this register to track all vendors that may process PHI.

## Current Register

- Vendor: Microsoft Azure
  - PHI touchpoint: application hosting (App Service), database (PostgreSQL Flexible Server),
    networking (VNet/NSG/Private Endpoints), AI inference (Azure OpenAI), speech
    (Azure Cognitive Services — STT/TTS), document intelligence, monitoring (Application Insights)
  - BAA required: yes
  - BAA status: covered_via_product_terms
  - BAA mechanism: Microsoft's HIPAA BAA coverage is included in the standard
    Data Processing Addendum (DPA) / Product Terms (formerly Online Services Terms).
    No separately signed bilateral document is required or issued — coverage is
    accepted automatically when you subscribe to HIPAA-eligible Azure services.
  - In-scope services verified: Azure App Service, Azure Database for PostgreSQL,
    Azure Virtual Network, Azure OpenAI, Azure AI Speech, Azure AI Document Intelligence,
    Azure Application Insights, Azure Private Endpoints / Private DNS
  - Restriction: Coverage applies only to properly configured in-scope Microsoft services.
    Customer is responsible for correct configuration (encryption, access controls,
    network isolation) — misconfiguration does not transfer liability to Microsoft.
  - Owner: Manucher Mehraein (Compliance/Engineering)
  - Last reviewed: 2026-03-13
  - Next review: 2026-06-02
  - Evidence link: `docs/compliance/evidence/baa-execution-log-2026-03-02.md`,
    `docs/compliance/evidence/baa-review-2026-03-13.md`,
    `docs/compliance/evidence/microsoft-dpa-baa-reference-2026-03-13.md`
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

- pending_execution — agreement required but not yet sent or signed
- in_legal_review — agreement under review by legal
- executed — separately signed bilateral BAA document on file
- covered_via_product_terms — BAA coverage included in vendor's standard DPA /
  Product Terms; no separate signature required (e.g., Microsoft Azure, AWS)
- not_required_documented — vendor does not process PHI in current posture;
  documented rationale on file
