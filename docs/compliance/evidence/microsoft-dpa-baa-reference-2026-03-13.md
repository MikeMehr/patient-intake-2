# Microsoft Azure — DPA / BAA Reference

- Document date: 2026-03-13
- Owner: Manucher Mehraein
- Purpose: Record the basis and evidence for Microsoft Azure's HIPAA BAA coverage

## How Microsoft's BAA Works

Microsoft does not issue a separately signed bilateral BAA. Instead, HIPAA Business
Associate Agreement coverage is incorporated into Microsoft's standard contractual
framework accepted at subscription time:

- **Data Processing Addendum (DPA):** Microsoft's DPA (formerly the Online Services
  Data Protection Addendum) includes HIPAA BAA provisions for HIPAA-eligible services.
  It is accepted as part of the Microsoft Customer Agreement or Enterprise Agreement.
- **Product Terms:** Microsoft Product Terms govern the use of online services and
  reference the DPA. They apply automatically when you subscribe to any covered service.
- **No signature required:** The DPA/BAA is a standard document offered to all
  customers. Acceptance is established at subscription time; Microsoft does not
  sign individual customer BAA documents on request.

## Public Evidence Links

- Microsoft Trust Center — HIPAA/HITECH:
  https://www.microsoft.com/en-us/trust-center/compliance/hipaa
- Microsoft Data Processing Addendum (DPA):
  https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA
- Microsoft Product Terms:
  https://www.microsoft.com/licensing/terms/
- Microsoft Service Trust Portal (audit reports, compliance artifacts):
  https://servicetrust.microsoft.com/
- List of HIPAA-eligible Azure services:
  https://learn.microsoft.com/en-us/azure/compliance/offerings/offering-hipaa-us

## In-Scope Azure Services — This Deployment

The following Azure services are used by this application and have been verified
as HIPAA-eligible under the Microsoft DPA/Product Terms:

| Service | Usage | HIPAA-eligible |
| --- | --- | --- |
| Azure App Service | Application hosting | Yes |
| Azure Database for PostgreSQL Flexible Server | PHI data storage | Yes |
| Azure Virtual Network (VNet) | Network isolation | Yes |
| Azure Network Security Groups (NSG) | Ingress/egress control | Yes |
| Azure Private Endpoints | Private connectivity to PaaS services | Yes |
| Azure Private DNS Zones | Private DNS resolution | Yes |
| Azure OpenAI Service | AI inference (disabled for PHI in HIPAA mode) | Yes |
| Azure AI Speech (Cognitive Services) | STT/TTS (disabled for PHI in HIPAA mode) | Yes |
| Azure AI Document Intelligence | Document parsing (disabled for PHI in HIPAA mode) | Yes |
| Azure Application Insights | Monitoring/telemetry | Yes |

## Customer Configuration Responsibility

Microsoft's BAA coverage does not transfer liability for misconfiguration.
This deployment must maintain:

- Private networking: all PaaS services accessed via Private Endpoints, no public ingress
- Encryption in transit: TLS enforced on all connections; `rejectUnauthorized=true` on DB pool
- Encryption at rest: Azure-managed encryption enabled on PostgreSQL and App Service storage
- Access controls: RBAC and least-privilege IAM enforced in the Azure subscription
- HIPAA mode: `HIPAA_MODE=true` in production disables external AI and voice routes
  that would transmit PHI outside the Azure BAA boundary

Evidence that these controls are in place:
- `infrastructure/main.bicep` — VNet, NSG, Private Endpoints, Private DNS provisioning
- `docs/compliance/evidence/azure-runtime-attestation-2026-03-02.md`
- `docs/compliance/launch-evidence-matrix.md` T-22 (DB TLS), T-25 (network/secret hardening)

## Renewal / Review

The Microsoft DPA/Product Terms are updated periodically by Microsoft. Material
changes are notified via the Service Trust Portal and/or the Microsoft 365 admin
center. No affirmative re-acceptance is required unless Microsoft requests it.

- This reference document should be re-verified:
  - Every 6 months (next: 2026-09-13)
  - After any Microsoft announcement of DPA/Product Terms changes
  - After adding a new Azure service to the deployment

## Approval

- Reviewed by: Manucher Mehraein
- Review date: 2026-03-13
