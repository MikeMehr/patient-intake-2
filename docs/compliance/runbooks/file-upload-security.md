# File Upload Security Runbook

## Purpose

Define the security controls applied to user-supplied file uploads and document
compensating controls where scanning services are not active.

## Scope

- Image uploads via `POST /api/analyze-lesion` (lesion photo triage)
- PDF generation via `POST /api/lab-requisitions/generate` (server-side; no external file ingestion)

## Production Posture (HIPAA Mode)

In production (`HIPAA_MODE=true`), the `analyze-lesion` image upload endpoint is
**disabled and returns HTTP 503**. No user-supplied image data reaches any processing
pipeline or external service. The lab-requisition endpoint generates PDFs server-side
via Playwright/Chromium and accepts no user-uploaded binaries.

This fail-closed posture is the primary control for upload-borne risk in PHI production.

## Controls Applied (analyze-lesion endpoint)

When `HIPAA_MODE` is not `true` (dev/staging only):

### 1. MIME type allowlist

Only the following content types are accepted:

| Type | Value |
| --- | --- |
| PNG | `image/png` |
| JPEG | `image/jpeg` |
| WebP | `image/webp` |
| HEIC | `image/heic`, `image/heic-sequence` |
| HEIF | `image/heif`, `image/heif-sequence` |

Files with any other MIME type are rejected with HTTP 400.

### 2. File extension allowlist (HEIC/HEIF fallback)

iOS devices sometimes send HEIC/HEIF without a recognized MIME type.
The endpoint also accepts files whose name ends in `.heic` or `.heif`.

### 3. Magic number (file signature) validation

The first 32 bytes of every upload are inspected against known signatures:

| Format | Magic bytes |
| --- | --- |
| PNG | `\x89PNG` (bytes 0–3) |
| JPEG | `\xff\xd8\xff` (bytes 0–2) |
| WebP | `RIFF????WEBP` (bytes 0–3 + 8–11) |
| HEIC/HEIF | `ftyp` box (bytes 4–7) + brand in known set |

Files that do not match any signature are rejected with HTTP 400 regardless of
their declared MIME type. This prevents content-type spoofing.

### 4. File size limit

Maximum accepted file size: **10 MB**.

Files exceeding this limit are rejected with HTTP 413 before content is read into
memory for further processing. This limits denial-of-service exposure and prevents
oversized payloads from reaching the AI pipeline.

### 5. No persistent storage

Uploaded images are not written to disk or blob storage. They are converted to
base64 in-memory and forwarded to Azure OpenAI (Vision API). No PHI persists
beyond the request lifetime in this path.

## Virus Scanning Status

| Environment | Scanning | Rationale |
| --- | --- | --- |
| Production (`HIPAA_MODE=true`) | Not required — uploads blocked | Fail-closed HIPAA guard prevents any image processing |
| Staging / dev | Not active | Non-PHI environment; MIME + magic-number + size controls applied |

**If PHI image uploads are ever enabled in production**, antivirus scanning must be
added before activation. Recommended options for Azure App Service:
- **Azure Defender for Storage** — if images are moved to Azure Blob Storage first
- **An external file-scanning API** (for example ClamAV-as-a-service or MetaDefender) called synchronously before any downstream processing

Any enablement of PHI image uploads must also reopen:
- Vendor BAA review (external AI provider must execute a BAA)
- PHI production scope document (`docs/compliance/phi-production-scope.md`)
- Upload scanning control attestation

## Governance

- Control owner: Engineering/Security
- Last review: 2026-03-13
- Next review: 2026-04-13
- Review cadence: monthly, and immediately after any change to upload endpoints

## Implementation Evidence

- `src/app/api/analyze-lesion/route.ts` — MIME allowlist, extension fallback, magic-number check, size limit, HIPAA-mode guard
- `docs/compliance/phi-production-scope.md` — PHI scope boundary

## Required Evidence for Audit

- This runbook (current version)
- Code review showing all four upload controls in `analyze-lesion/route.ts`
- Confirmation that `HIPAA_MODE=true` is set in production (disabling the endpoint)
- Evidence of any future antivirus integration if PHI uploads are enabled
