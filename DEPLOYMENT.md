# Deployment Guide

This guide will help you deploy the patient intake application to a live web server.

## Option 1: Vercel (Recommended - Easiest)

Vercel is made by the Next.js team and provides the easiest deployment experience.

### Steps:

1. **Push your code to GitHub** (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Sign up/Login to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Sign up with your GitHub account (free tier available)

3. **Import your project**:
   - Click "Add New Project"
   - Import your GitHub repository
   - Vercel will auto-detect Next.js settings

4. **Configure Environment Variables**:
   - In the project settings, go to "Environment Variables"
   - Add the following:
     - `OPENAI_` = your OpenAI API key (required)
     - `OPENAI_MODEL` = `gpt-4o-mini` (optional, this is the default)
     - `OPENAI_VISION_MODEL` = `gpt-4o` (optional, for image analysis)
     - `MOCK_AI` = leave empty for production (only set to `true` for testing)

5. **Deploy**:
   - Click "Deploy"
   - Wait 2-3 minutes for the build to complete
   - Your app will be live at `https://your-project-name.vercel.app`

6. **Custom Domain (Optional)**:
   - In project settings → Domains
   - Add your custom domain

### Vercel Benefits:
- ✅ Free tier with generous limits
- ✅ Automatic HTTPS
- ✅ Automatic deployments on git push
- ✅ Built-in CI/CD
- ✅ Global CDN
- ✅ Zero configuration needed

---

## Option 2: Other Platforms

### Netlify
1. Sign up at [netlify.com](https://netlify.com)
2. Connect your GitHub repo
3. Build command: `npm run build`
4. Publish directory: `.next`
5. Add environment variables in site settings

### Railway
1. Sign up at [railway.app](https://railway.app)
2. Create new project from GitHub
3. Add environment variables
4. Railway auto-detects Next.js

### Render
1. Sign up at [render.com](https://render.com)
2. Create new Web Service
3. Connect GitHub repo
4. Build command: `npm run build`
5. Start command: `npm start`
6. Add environment variables

### Self-Hosted (VPS/Server)
If you have your own server:

1. **Build the application**:
   ```bash
   npm run build
   ```

2. **Set environment variables**:
   ```bash
   export OPENAI_API_KEY=your-key-here
   export OPENAI_MODEL=gpt-4o-mini
   export OPENAI_VISION_MODEL=gpt-4o
   ```

3. **Start the production server**:
   ```bash
   npm start
   ```

4. **Use a process manager** (PM2 recommended):
   ```bash
   npm install -g pm2
   pm2 start npm --name "patient-intake" -- start
   pm2 save
   pm2 startup
   ```

5. **Set up reverse proxy** (nginx example):
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

---

## Required Environment Variables

Make sure to set these in your deployment platform:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | ✅ Yes | - | Your OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model for interview questions |
| `OPENAI_VISION_MODEL` | No | `gpt-4o` | Model for image analysis |
| `MOCK_AI` | No | - | Set to `true` only for testing |

---

## Post-Deployment Checklist

- [ ] Environment variables are set correctly
- [ ] Test the interview flow with a sample complaint
- [ ] Test image upload functionality
- [ ] Verify HTTPS is enabled (should be automatic on most platforms)
- [ ] Check that API routes are working
- [ ] Test on mobile devices
- [ ] Review error handling

---

## Important Security Notes & Retention

⚠️ **Healthcare Data Considerations**:
- This application is **NOT HIPAA-compliant** out of the box
- Do NOT store PHI (Protected Health Information) without proper safeguards
- Consider adding:
  - Authentication/authorization
  - Data encryption at rest
  - Audit logging
  - HIPAA-compliant hosting (if handling real patient data)
  - Terms of service and privacy policy

⚠️ **API Key Security**:
- Never commit API keys to git
- Use environment variables only
- Rotate keys if exposed
- Monitor API usage in OpenAI dashboard

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
- Check Node.js version (needs 18+)
- Ensure all dependencies are in `package.json`
- Check build logs for specific errors

### API Errors
- Verify `OPENAI_API_KEY` is set correctly
- Check OpenAI API usage limits
- Review error logs in deployment platform

### Image Upload Issues
- Verify `OPENAI_VISION_MODEL` is set (defaults to `gpt-4o`)
- Check file size limits (may need to configure in platform)
- Ensure vision model supports image analysis

---

## Need Help?

- Vercel Docs: https://vercel.com/docs
- Next.js Deployment: https://nextjs.org/docs/deployment
- OpenAI API: https://platform.openai.com/docs

