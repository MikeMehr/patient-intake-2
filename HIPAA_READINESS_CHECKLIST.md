# HIPAA Readiness Checklist (Engineering-Focused)

This is a practical checklist to keep the app from leaking PHI and to align with common HIPAA technical safeguards. It’s not legal advice—coordinate with compliance.

## App configuration
- [ ] Set `HIPAA_MODE=true` in production to block external AI calls and outbound invitations that email PHI.
- [ ] Use only HIPAA-eligible services with BAAs (cloud, email/SMS, error tracking, storage, AI). Disable or avoid sending PHI to any service without a BAA.
- [ ] Enforce HTTPS/HSTS; no HTTP endpoints.
- [ ] Keep database and object storage private (VPC/private subnets; no public ingress).

## Secrets & credentials
- [ ] Store secrets in a secrets manager (not in repo). Rotate DB/API keys regularly.
- [ ] Keep `GOOGLE_AI_API_KEY`, `RESEND_API_KEY`, and DB credentials out of logs and responses.

## Authentication & authorization
- [ ] Strong passwords + MFA for admin users; short session TTL; logout invalidates server-side sessions.
- [ ] Server-side role checks for super_admin/org_admin/provider on all admin/org/provider routes.
- [ ] Cookies: `secure`, `httpOnly`, `sameSite=lax/strict`, over TLS only in production.
- [ ] Rate-limit auth endpoints; monitor for abuse.

## Logging & monitoring
- [ ] Do not log PHI (names, emails, complaints, transcripts, lab summaries, images).
- [ ] Centralize audit logs for auth events (success/failure/reset) to a secured sink with retention/ACLs.
- [ ] Alerts for auth anomalies, data export volumes, and 5xx spikes.

## File uploads & storage
- [ ] Restrict allowed types; validate magic numbers; size limits (done in API).
- [ ] Virus-scan uploads before use; store in HIPAA-compliant private storage with signed URLs; no public buckets/CDNs for PHI.
- [ ] Define retention/deletion for PDFs/images and enforce lifecycle rules.

## Email/SMS
- [ ] Use HIPAA-capable provider with BAA; do not include PHI in email/SMS bodies.
- [ ] Prefer portal links with short-lived, single-use tokens. Disable sending when `HIPAA_MODE=true`.

## Data lifecycle
- [ ] Encrypted at rest (DB, disks, object storage) and in transit (TLS).
- [ ] Backups encrypted; tested restores; defined retention; secure deletion on expiry.
- [ ] Avoid production PHI in dev/test; use de-identified data; isolate environments.

## Operational safeguards
- [ ] Endpoint protection and MFA for engineers; least-privilege IAM to prod.
- [ ] Regular vulnerability scans/patching and dependency updates.
- [ ] Incident response runbook and breach notification procedures in place.

## Frontend UX (if HIPAA mode on)
- [ ] Clearly communicate when features are disabled due to HIPAA mode (e.g., external AI analysis, auto-email invites).




