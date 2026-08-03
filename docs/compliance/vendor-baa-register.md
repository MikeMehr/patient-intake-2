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

- Vendor: Doxy.me (video visits)
  - PHI touchpoint: carries live consultation audio/video between patient and physician. No
    recording is used, so no call content is stored.
  - BAA required: yes
  - BAA status: pending_execution
  - Notes: replaced Daily.co on 2026-08-03. Daily's healthcare tier — the only one carrying a
    signed agreement — was $500/month against a few hundred participant-minutes a year, so the
    service ran on standard commercial terms with no bilateral agreement. Doxy offers a BAA at
    no or nominal cost, which closes that gap.
  - Architecture note: one permanent waiting room per provider, stored in
    `physicians.doxy_room_url`. There are no per-visit rooms and no join tokens; the patient
    opens the room, enters a name, and the provider admits them. Access control is the provider
    recognising who turned up. Accepted deliberately as proportionate at this volume.
  - Residual risk accepted: Doxy is US-hosted, so consultation media still crosses the border.
    PIPA does not impose the Canada-only residency rule FIPPA places on public bodies, so this
    is a disclosure question rather than a prohibition — but see the outstanding item below.
  - Patient disclosure: OUTSTANDING. Patients are still not told their video consultation is
    processed outside Canada. This carried over unchanged from the Daily entry and remains the
    cheapest open item — a line in the booking consent text and the confirmation email.
  - Reassess if: video volume grows beyond occasional use, or any recording feature is
    contemplated.
  - Owner: Manucher Mehraein
  - Last reviewed: 2026-08-03
  - Next review: 2026-11-03
  - Approver: Manucher Mehraein

- Vendor: Daily.co (video visits) — REMOVED 2026-08-03
  - Integration deleted; no API key, no account in use, no data retained by us. Recorded here
    rather than dropped so the register shows what was evaluated and why it was not kept.
  - Reason: healthcare tier disproportionate to volume; replaced by Doxy.me.

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
