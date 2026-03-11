# Deployment Guide

This guide explains how to deploy the patient intake application to **Microsoft Azure App Service** using the built-in GitHub Actions CI/CD pipeline.

---

## Microsoft Azure App Service

The repository ships a ready-made GitHub Actions workflow
(`.github/workflows/main_healt-assist-ai-prod.yml`) that builds the app and
deploys it to Azure App Service on every push to `main`.

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| Azure subscription | [Free trial](https://azure.microsoft.com/free/) available |
| Azure App Service (Linux, Node 20) | Standard S1 or higher recommended for production |
| Azure Database for PostgreSQL | Flexible Server recommended |
| GitHub repository | Workflow is already committed |

### Step 1 — Create the Azure Web App

```bash
# Install the Azure CLI if needed: https://docs.microsoft.com/cli/azure/install-azure-cli
az login

# Create a resource group
az group create --name patient-intake-rg --location eastus

# Create the App Service plan (Linux, Standard S1)
az appservice plan create \
  --name patient-intake-plan \
  --resource-group patient-intake-rg \
  --sku S1 \
  --is-linux

# Create the Web App (Node 20 LTS)
az webapp create \
  --name healt-assist-ai-prod \
  --resource-group patient-intake-rg \
  --plan patient-intake-plan \
  --runtime "NODE:20-lts"

# Configure Node to start the standalone server
az webapp config set \
  --name healt-assist-ai-prod \
  --resource-group patient-intake-rg \
  --startup-file "node server.js"
```

### Step 2 — Create the Azure Service Principal for GitHub Actions

The GitHub Actions workflow authenticates to Azure with a service principal
stored in the `AZURE_CREDENTIALS` repository secret.

```bash
# Replace <subscription-id> with your Azure subscription ID
az ad sp create-for-rbac \
  --name "patient-intake-github-actions" \
  --role contributor \
  --scopes /subscriptions/<subscription-id>/resourceGroups/patient-intake-rg \
  --sdk-auth
```

Copy the full JSON output — it looks like:

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "subscriptionId": "...",
  "tenantId": "..."
}
```

In your GitHub repository go to **Settings → Secrets and variables → Actions →
New repository secret**, name it `AZURE_CREDENTIALS`, and paste the JSON.

### Step 3 — Provision a PostgreSQL Database

```bash
# Create an Azure Database for PostgreSQL – Flexible Server
az postgres flexible-server create \
  --name patient-intake-db \
  --resource-group patient-intake-rg \
  --location eastus \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 16 \
  --admin-user dbadmin \
  --admin-password "<strong-password>" \
  --public-access None   # keep private; use VNet integration

# Create the application database
az postgres flexible-server db create \
  --server-name patient-intake-db \
  --resource-group patient-intake-rg \
  --database-name patientintake
```

Set `DATABASE_URL` in the next step using the connection string:
```
postgresql://dbadmin:<password>@patient-intake-db.postgres.database.azure.com:5432/patientintake?sslmode=require
```

### Step 4 — Configure Application Settings

Set every required environment variable as an **Application Setting** in
Azure App Service (Portal: Web App → Configuration → Application Settings,
or via CLI):

```bash
az webapp config appsettings set \
  --name healt-assist-ai-prod \
  --resource-group patient-intake-rg \
  --settings \
    DATABASE_URL="postgresql://..." \
    SESSION_SECRET="<32-byte-random-string>" \
    PATIENT_PHI_ENCRYPTION_KEY="<base64-32-bytes>" \
    EMR_ENCRYPTION_KEY="<base64-32-bytes>" \
    PATIENT_HIN_HASH_PEPPER="<random-pepper>" \
    AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com/" \
    AZURE_OPENAI_API_KEY="<key>" \
    AZURE_OPENAI_DEPLOYMENT="gpt-4o" \
    AZURE_PHI_ENDPOINT="https://your-resource.openai.azure.com/" \
    AZURE_PHI_DEPLOYMENT="gpt-4o" \
    AZURE_SPEECH_KEY="<key>" \
    AZURE_SPEECH_REGION="eastus" \
    AZURE_DOCUMENT_INTELLIGENCE_API_KEY="<key>" \
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://your-resource.cognitiveservices.azure.com/" \
    RESEND_API_KEY="re_<key>" \
    NEXT_PUBLIC_APP_URL="https://healt-assist-ai-prod.azurewebsites.net" \
    NODE_ENV="production"
```

> **Tip:** Use [Azure Key Vault references](https://docs.microsoft.com/azure/app-service/app-service-key-vault-references)
> (`@Microsoft.KeyVault(SecretUri=...)`) for sensitive values so they are
> never stored in plain text in App Service configuration.

See `.env.example` at the root of this repository for the full list of
variables with descriptions.

### Step 5 — Push to `main` to Trigger Deployment

```bash
git push origin main
```

The GitHub Actions workflow will:
1. Install dependencies (`npm ci`)
2. Run the production security audit (`npm run audit:prod`)
3. Build the Next.js standalone bundle (`next build`)
4. Package the bundle as `deploy.zip`
5. Authenticate to Azure and deploy to the `Production` slot

Monitor the deployment in the **Actions** tab of your GitHub repository.
After a successful run your app is live at:
`https://healt-assist-ai-prod.azurewebsites.net`

### Step 6 — Configure a Custom Domain (Optional)

```bash
# Add a custom domain
az webapp config hostname add \
  --webapp-name healt-assist-ai-prod \
  --resource-group patient-intake-rg \
  --hostname yourdomain.com

# Bind a managed TLS certificate (free)
az webapp config ssl bind \
  --name healt-assist-ai-prod \
  --resource-group patient-intake-rg \
  --certificate-thumbprint <thumbprint> \
  --ssl-type SNI
```

---

## Required Environment Variables

See `.env.example` for the complete reference.  The table below lists the
minimum set needed to start the application.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ | Session encryption key (32+ random bytes) |
| `PATIENT_PHI_ENCRYPTION_KEY` | ✅ | AES-256-GCM key for PHI (base64, 32 bytes) |
| `EMR_ENCRYPTION_KEY` | ✅ | AES-256-GCM key for EMR data (base64, 32 bytes) |
| `AZURE_OPENAI_ENDPOINT` | ✅ | Azure OpenAI resource endpoint |
| `AZURE_OPENAI_API_KEY` | ✅ | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | ✅ | Deployment name for the main model |
| `AZURE_PHI_ENDPOINT` | ✅ | Endpoint for vision/PHI detection model |
| `AZURE_PHI_DEPLOYMENT` | ✅ | Deployment name for vision/PHI model |
| `RESEND_API_KEY` | ✅ | Resend API key for email |
| `NEXT_PUBLIC_APP_URL` | ✅ | Public base URL (used in emails & OAuth) |

---

## Post-Deployment Checklist

- [ ] All required environment variables are set
- [ ] Database connection is working (check App Service logs)
- [ ] HTTPS / TLS is enforced (automatic on Azure App Service)
- [ ] Test the interview flow with a sample complaint
- [ ] Test image upload functionality
- [ ] Test speech-to-text / text-to-speech if Azure Speech is enabled
- [ ] Verify PDF lab-requisition generation
- [ ] Check that API routes return expected responses
- [ ] Test on mobile devices
- [ ] Run `npm run audit:prod` locally to verify no high/critical CVEs
- [ ] Rotate the default `SUPER_ADMIN_PASSWORD` immediately after first login

---

## Important Security Notes & Retention

⚠️ **API Key Security**:
- Never commit API keys or secrets to git
- Store secrets in Azure Key Vault and reference them from App Service
- Rotate keys if exposed; monitor API usage dashboards

🔒 **PHI Retention & Deletion**:
- Patient sessions are deleted after 24h by default. To change retention, set `SESSION_EXPIRY_HOURS` (e.g., to `12` for 12h). Keep it as short as operationally feasible.
- Ensure database/storage backups are encrypted and respect retention/disposal policies that match PHI requirements.
- Avoid writing PHI to temp files or logs; keep DEBUG_LOGGING off in production.

## Telemetry Hygiene (App Insights / APM)

- If enabling Application Insights or other APM, do **not** capture request/response bodies or headers. Collect only metadata (route, status, duration, request-id).
- Keep `DEBUG_LOGGING` **false** in production; rely on `logRequestMeta` for minimal logs.
- Mask or drop sensitive fields in telemetry processors (e.g., `Authorization`, `Cookie`, `Set-Cookie`, `body`, `headers`, `patientEmail`, `patientName`, `chiefComplaint`, `transcript`, `labReportSummary`, `formSummary`).
- For OTEL exporters, disable span attribute/body capture and prefer an allowlist of safe attributes.
- Avoid logging PHI in customDimensions/customAttributes; hash identifiers if needed for correlation.
- If using Azure App Insights, set `APPINSIGHTS_CONNECTION_STRING` in the environment and call `initTelemetry()` (see `src/lib/telemetry.ts`) once at server startup. The helper drops bodies/headers and strips query strings.

## Network Isolation Checklist (Azure)
- Azure OpenAI: enable Private Endpoint; disable public network access; ensure `AZURE_OPENAI_ENDPOINT` resolves via private DNS in your VNet.
- Database/Storage: enable Private Endpoints for Postgres/SQL and any storage buckets; disable public network access; restrict to VNet subnets.
- App hosting: run app with VNet integration or inside the same VNet so traffic to DB/OpenAI stays private.
- Egress controls: restrict outbound to required services (DB/storage/Azure OpenAI private endpoints); consider NSGs or firewall allowlists.
- TLS: enforce HTTPS/TLS 1.2+ everywhere; no HTTP fallbacks; set Secure/HttpOnly cookies.

## Access Control & Secrets
- MFA: Require MFA for all admin/operator accounts (AAD). Disable legacy auth.
- Least privilege: Use per-service managed identities/service principals with minimal roles. Avoid broad `Contributor`; prefer scoped `Reader`/`User Access Administrator` for audits and narrow data-plane roles for DB/storage/OpenAI.
- DB/Storage ACLs: Allow only VNet/private endpoints; restrict IPs; disable public network access.
- Secrets: Keep `SESSION_SECRET` strong (32+ random bytes) and set in prod; store all keys in Key Vault/CI secrets. Do not commit real values to `.env*`.

---

## Troubleshooting

### Build Fails
- Check Node.js version (requires 20+)
- Ensure all dependencies are in `package.json`
- Check the **Actions** tab in GitHub for the full build log

### App Won't Start After Deploy
- Confirm the startup command is set to `node server.js` (Azure Portal: Web App → Configuration → General settings → Startup Command)
- Check **App Service Logs** (Portal: Web App → Log stream) for runtime errors
- Verify all required environment variables are set in Application Settings

### API Errors
- Verify Azure OpenAI credentials (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`) are set correctly
- Check Azure OpenAI quota and deployment status in the Azure Portal
- Review the App Service log stream for stack traces

### Database Connection Errors
- Confirm `DATABASE_URL` is set and includes `?sslmode=require`
- Ensure the App Service has network access to the PostgreSQL server (VNet integration or firewall rule)
- Test connectivity from the App Service console: **Portal → Web App → SSH → Console**

### Image Upload Issues
- Verify `AZURE_PHI_ENDPOINT` and `AZURE_PHI_DEPLOYMENT` are set
- Check file size limits in Azure App Service (default 30 MB; increase via `WEBSITE_MAX_REQUEST_SIZE` if needed)

---

## Need Help?

- Azure App Service docs: https://docs.microsoft.com/azure/app-service/
- Azure CLI reference: https://docs.microsoft.com/cli/azure/
- Next.js deployment docs: https://nextjs.org/docs/deployment
