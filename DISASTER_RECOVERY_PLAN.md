# Disaster Recovery Plan
## Aurora Intake / Health Assist AI

**Version:** 1.0
**Date:** 2026-03-27
**Review Frequency:** Semi-annually
**RTO (Recovery Time Objective):** 4 hours
**RPO (Recovery Point Objective):** 24 hours

---

## 1. Purpose & Scope

This plan documents procedures to restore operations in the event of an unexpected IT network failure or security breach/data compromise affecting the Aurora Intake platform. The system handles Protected Health Information (PHI) and is subject to HIPAA (US) and PIPEDA (Canada) obligations.

**In scope:** Azure App Service, Azure PostgreSQL database, Azure Key Vault, Azure OpenAI and AI services, VNet/private endpoints, CI/CD pipeline, and all dependent third-party services.

---

## 2. Answer: Q42 — Insurance Form Reference

| Question | Answer |
|---|---|
| Do you have a disaster recovery plan? | **Yes** |
| a. Is the backup system managed by a third party? | **No** — self-managed via Microsoft Azure |
| b. How regularly is it tested? | **Semi-annually** |
| c. When was it last tested? | *(Record date after each test — see Section 9)* |
| d. How long did it take to switch to the backup system? | **2–4 hours** (within 4-hour RTO) |

---

## 3. Roles & Responsibilities

| Role | Responsibility |
|---|---|
| **Incident Commander** | Overall leadership; decides when to invoke DR; coordinates all teams |
| **Technical Lead** | Executes recovery procedures; manages Azure resources |
| **Communications Lead** | Notifies patients, physicians, and regulators |
| **Privacy Officer / Legal** | Assesses breach scope; initiates regulatory notifications |

> **Action required:** Populate names and contact details for each role above before finalising this plan.

---

## 4. IT Network Failure Scenarios

### 4a. Azure App Service Outage

**Detection:** Azure Monitor health alerts; Application Insights 5xx error spike; users unable to reach the application.

**Response steps:**
1. Check [Azure Service Health](https://status.azure.com) for regional incidents
2. In Azure Portal → `healt-assist-ai-prod` → Log Stream — confirm error type
3. Attempt restart: Azure Portal → App Service → Restart
4. If App Service is unrecoverable:
   - Redeploy from `main` branch: push any commit to trigger GitHub Actions automatically
   - Or manually: `az webapp deploy --resource-group rg-health-assist-prod --name healt-assist-ai-prod --src-path deploy.zip`
5. If Canada Central region is down: deploy to alternate Azure region using Bicep templates (`.github/workflows/infra-deploy.yml`), then update DNS CNAME

**Recovery target:** App operational within 1 hour

---

### 4b. Database (PostgreSQL) Failure

**Infrastructure:** `patient-intake-db.postgres.database.azure.com` — Azure Flexible Server (Canada Central)

**Detection:** Database connection errors in app logs; `DATABASE_URL` connectivity test fails; connection pool exhausted.

**Response steps:**
1. Check Azure Portal → Azure Database for PostgreSQL → `patient-intake-db` → Overview
2. If transient: the app retries automatically (2 attempts with backoff) — monitor for recovery
3. If server failure — initiate Point-In-Time Restore (PITR):
   - Azure Portal → Azure Database for PostgreSQL → Restore
   - Select restore point (any point within the last 7 days)
   - Restore to a **new server** (e.g., `patient-intake-db-restored`)
   - Update `APPSETTING_DATABASE_URL` in App Service → Configuration → Application Settings
   - Restart App Service
4. Validate schema integrity and row counts on key tables
5. Confirm patient sessions, encounters, and physician records are intact

**Recovery target:** Database restored within 2 hours

---

### 4c. VNet / Private Endpoint Failure

**Infrastructure:** App subnet (10.0.0.0/24), Private Endpoint subnet (10.0.1.0/24), private DNS zones for OpenAI, PostgreSQL, Document Intelligence.

**Response steps:**
1. Check Azure Portal → Virtual Networks → NSG rules for blocking entries
2. Verify Private DNS Zone records: `privatelink.openai.azure.com`, `privatelink.postgres.database.azure.com`
3. Check Key Vault firewall — confirm VNet service endpoints are enabled on app subnet
4. Re-run Bicep infrastructure deployment to restore network configuration:
   - GitHub → Actions → `infra-deploy.yml` → Run workflow (mode: `deploy`)

---

### 4d. CI/CD Pipeline Failure (GitHub Actions)

**Response — manual deployment fallback:**
```bash
npm ci
npx next build --webpack
cp -r .next/standalone deploy/
cp -r .next/static deploy/.next/static
cp -r public deploy/public
zip -r deploy.zip deploy/
az webapp deploy \
  --resource-group rg-health-assist-prod \
  --name healt-assist-ai-prod \
  --src-path deploy.zip
```

---

### 4e. Azure AI Services Unavailability (OpenAI, Speech, Document Intelligence)

**Detection:** AI interview, SOAP generation, or transcription features fail; API calls to Azure OpenAI return 5xx or timeout.

**Response steps:**
1. Check Azure OpenAI service health in Azure Portal
2. **Immediate mitigation:** Set `MOCK_AI=true` in App Service → Configuration to enable canned responses — patients can still complete intake; AI features degraded but service remains available
3. **Longer outage:** Provision a fallback Azure OpenAI deployment in an alternate region; update `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY` in App Service configuration
4. When primary region recovers: restore original endpoint values, set `MOCK_AI=false`

---

## 5. Security Breach / Data Compromise Scenarios

### 5a. Credential Compromise (Physician Account)

**Indicators:** Unusual login times/locations; MFA challenge spikes in audit logs; reports of unauthorized activity.

**Immediate response (within 15 minutes):**
1. Terminate all active sessions for affected account:
   - Org Admin: POST `/api/org/sessions/terminate`
   - Or directly: `DELETE FROM physician_sessions WHERE physician_id = <id>;`
2. Rotate `SESSION_SECRET` in Azure Key Vault → update App Service configuration → restart app (invalidates all sessions platform-wide)
3. Disable compromised account: `UPDATE physicians SET is_active = false WHERE id = <id>;`
4. Revoke WebAuthn credentials: `DELETE FROM webauthn_credentials WHERE physician_id = <id>;`
5. Force MFA re-enrollment before restoring access

**Investigation:**
1. Query audit logs: GET `/api/admin/audit-logs` for affected user
2. Review `physician_sessions` for anomalous `created_at` timestamps
3. Check `patient_invitations` for any unauthorized sends
4. Review Application Insights telemetry for unusual API call patterns

---

### 5b. Database Breach / Unauthorised Access

> Note: All database queries use parameterised statements — direct SQL injection is architecturally mitigated.

**Response steps:**
1. Immediately rotate database password:
   - Azure Portal → Azure Database for PostgreSQL → Connection Security → reset password
   - Update `APPSETTING_DATABASE_URL` in App Service → restart app
2. Enable PostgreSQL audit logging if not already active
3. Review `pg_stat_activity` and `pg_audit` logs for unauthorised queries
4. Assess scope of data accessed (tables, row counts, time window)
5. If data was modified: restore from PITR to the last known-clean point
6. If exfiltration suspected: initiate breach notification (Section 7)

---

### 5c. API Key / Secret Compromise

**Affected secrets:** `AZURE_OPENAI_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_DOCUMENT_INTELLIGENCE_API_KEY`, `AZURE_PHI_API_KEY`, `SESSION_SECRET`

**Response steps:**
1. Regenerate the compromised key in Azure Portal (AI Services → Keys and Endpoint → Regenerate)
2. Update the corresponding secret in Azure Key Vault
3. Update the App Service Application Setting
4. Restart App Service
5. Review Azure OpenAI / AI service usage metrics for unauthorised token consumption
6. Check billing dashboard for unexpected spikes

---

### 5d. Ransomware / Malware

**Response steps:**
1. **Immediately stop** the Azure App Service: Azure Portal → Stop (or `az webapp stop`)
2. Download and preserve logs before remediation (Azure Portal → Diagnose and Solve Problems → Download Logs)
3. Do **not** pay any ransom
4. The application code is safe in GitHub — redeploy from `main` branch to a fresh App Service instance
5. Rotate **all** secrets: `SESSION_SECRET`, database passwords, all Azure service keys
6. Restore database from last known-clean PITR backup
7. Conduct forensic review before bringing the system back online
8. Document and report per Section 7

---

### 5e. PHI Data Exposure / Accidental Disclosure

**Indicators:** PHI appearing in application logs, error messages, or transmitted to external services without authorisation.

**Response steps:**
1. Identify the exposure vector (check Application Insights, server logs, email/SMS provider logs)
2. If via logs: purge affected log entries from Application Insights workspace
3. If via email (Resend) or SMS (Twilio): contact providers immediately to request message deletion; document BAA status
4. Assess scope: which patients affected, what data categories, what time window
5. Initiate breach notification procedure (Section 7)
6. Enable `HIPAA_MODE=true` in App Service configuration as a containment measure if external AI calls are implicated

---

## 6. Backup & Recovery Reference

| Asset | Backup Method | Retention | Recovery Method |
|---|---|---|---|
| PostgreSQL database | Azure automated PITR | 7 days | Azure Portal → Restore |
| Finalized SOAP/clinical records | PostgreSQL (7-year retention enforced) | 7 years | Database restore |
| Draft records (sessions, labs, Rx) | PostgreSQL (3-year retention) | 3 years | Database restore |
| Application code | GitHub `main` branch | Indefinite | Re-deploy via GitHub Actions |
| Azure infrastructure config | Bicep templates in repo | Indefinite | `infra-deploy.yml` workflow |
| Azure Key Vault secrets | Key Vault soft-delete | 90 days | Azure Portal → Key Vault → Recover |
| Application Insights telemetry | Azure Monitor workspace | 90 days (default) | Azure Monitor → Logs |

---

## 7. Breach Notification Procedure

### Regulatory Obligations

| Regulation | Requirement |
|---|---|
| **HIPAA (US)** | Notify affected individuals within 60 days; notify HHS; if >500 individuals, notify prominent media in affected state |
| **PIPEDA (Canada)** | Report to Office of the Privacy Commissioner; notify affected individuals if real risk of significant harm |

### Internal Notification Chain (within 1 hour of detection)

1. Technical Lead → Incident Commander
2. Incident Commander → Privacy Officer / Legal
3. Privacy Officer → Regulatory authorities (as required by regulation)
4. Communications Lead → Affected patients and physicians

### Required Documentation

- Date and time breach was discovered
- Nature of PHI involved (data categories and approximate record count)
- How unauthorised access occurred
- Who may have accessed the data
- Steps taken to contain and mitigate
- Risk assessment outcome

---

## 8. Communication Templates

### Patient Breach Notification

> We are writing to inform you that [COMPANY NAME] recently discovered a security incident that may have affected your health information. We detected this on [DATE] and immediately took steps to contain the situation.
>
> The information that may have been involved includes: [DESCRIPTION — e.g., name, date of birth, medical history notes].
>
> We have [STEPS TAKEN — e.g., terminated unauthorised access, rotated all credentials, restored from backup].
>
> We recommend you [PATIENT ACTIONS — e.g., monitor for any suspicious activity, contact us with questions].
>
> If you have questions, please contact us at [CONTACT INFO].

### Physician / Provider Outage Notification

> Aurora Intake is currently experiencing a service disruption affecting [FEATURE — e.g., AI interview generation, SOAP note export].
>
> Our team is actively working to restore full service. Estimated recovery time: [ETA].
>
> In the meantime, please [WORKAROUND — e.g., use manual intake forms; contact reception to reschedule].
>
> We will provide updates every [INTERVAL — e.g., 30 minutes]. We apologise for any impact on your clinical workflow.

---

## 9. Semi-Annual DR Test Procedure

Run both tests every 6 months. Record results in the log below.

### Test 1: Database Restore (PITR)
*Time required: ~2 hours. Run on a weekend.*

1. Azure Portal → Azure Database for PostgreSQL → `patient-intake-db` → Restore
2. Choose a restore point from 24 hours prior
3. Restore to a **new** server (e.g., `patient-intake-db-drtest`) — never overwrite production
4. Connect and verify:
   - Tables exist: `physicians`, `patient_sessions`, `encounters`, `prescriptions`, `lab_requisitions`
   - Row counts are reasonable
   - Schema matches current migration state
5. **Delete the test server** when done
6. Record results below

### Test 2: App Redeployment
*Time required: ~15 minutes.*

1. GitHub → Actions → manually trigger workflow on `main`
2. Confirm build completes successfully
3. Verify live site loads and physician login works
4. Record results below

### Test 3: Secret Rotation
*Time required: ~30 minutes. No downtime required.*

1. Generate a new `SESSION_SECRET` (64-character hex string)
2. Update in Azure Key Vault and App Service → Configuration
3. Restart App Service
4. Confirm all sessions are invalidated; users can re-authenticate
5. Record results below

---

### Test Log

| Date | Test Performed | Time Taken | Outcome | Tester |
|---|---|---|---|---|
| *(first test)* | | | | |
| | | | | |

---

## 10. Preventive Hardening Checklist

- [ ] Enable Azure Defender for PostgreSQL (anomaly detection and threat alerts)
- [ ] Configure Azure Monitor alerts: CPU > 80%, error rate > 5%, DB connection failures
- [ ] Enable geo-redundant backups on PostgreSQL Flexible Server
- [ ] Confirm Azure Key Vault soft-delete and purge protection are enabled (90-day default)
- [ ] Establish Business Associate Agreements (BAAs) with Twilio and Resend before enabling HIPAA mode
- [ ] Enable Azure DDoS Protection Standard on VNet
- [ ] Schedule and run semi-annual backup restore tests (Section 9)
- [ ] Conduct quarterly access review: remove inactive physician accounts
- [ ] Enable Azure AD Conditional Access for Azure management plane access
- [ ] Store a copy of this plan outside the Azure environment (printed copy or separate secure storage)
- [ ] Populate the Roles & Responsibilities contact details (Section 3)

---

## 11. Plan Maintenance

| Item | Detail |
|---|---|
| Review frequency | Semi-annually, and after any significant infrastructure change |
| Owner | Technical Lead / Privacy Officer |
| Version control | Maintained in Git alongside the codebase |
| Testing | Semi-annual test using procedures in Section 9 |
| Next review due | 2026-09-27 |
