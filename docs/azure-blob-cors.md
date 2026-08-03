# Azure Blob CORS for secure file sharing

## TL;DR

**If you change the app's domain, change `NEXT_PUBLIC_APP_URL` in App Service. Nothing else
is required** — the app repairs its own storage CORS rule on the next share.

If uploads are broken right now:

```bash
./scripts/set-blob-cors.sh healthassistaistorage --apply
```

## What needs a CORS rule, and why

Exactly one flow: **Send files** on `/org/documents` (outbound clinic → recipient). Files
there can be 200 MB, well past what an Azure Web App request will carry, so the browser PUTs
straight to Azure Blob Storage using a short-lived, single-blob write-SAS
(`generateDocumentWriteSasUrl` in `src/lib/azure-blob-documents.ts`).

A cross-origin `PUT` with custom headers triggers a CORS preflight, and Azure answers that
preflight from a rule stored on the **storage account** — not in this repo, not in Bicep, not
in App Service settings.

Nothing else in the app needs one:

| Flow | Mechanism | Needs CORS? |
|---|---|---|
| Send files (outbound) | browser → Azure, write-SAS | **yes** |
| Patient upload (inbound) | browser → `/api/uploads/[token]` → Azure | no (server-side) |
| Transcription audio | browser → API route → Azure | no (server-side) |
| Downloads | read-SAS as a plain `href` | no (top-level navigation) |

That asymmetry is why downloads kept working through the outage while sends did not.

## The failure it protects against

August 2026: the physician dashboard moved from `mymd.health-assist.org` to
`physician.health-assist.org`. The blob CORS rule still named the old host, so every upload
died on:

```
OPTIONS https://healthassistaistorage.blob.core.windows.net/patient-documents/...
403  CORSNotEnabled: CORS not enabled or no matching rule found for this request.
```

Two things made it hard to see. The server never observes a rejected preflight — the browser
does — so there was nothing in the app logs. And `mymd.health-assist.org` is 301-redirected at
`src/proxy.ts` before any JS runs, so the rule that *looked* live could never have matched.

## How it stays fixed

`ensureDocumentsCors()` in `src/lib/azure-blob-documents.ts` runs when a share is created
(`POST /api/org/documents/shares`) and guarantees a rule exists for this app's own origin.

The origin comes from **`NEXT_PUBLIC_APP_URL`** — already the source of truth for every
emailed link, reset URL and booking URL. You cannot move the domain without changing it, or
every emailed link breaks loudly. That welds the silent failure to a loud one.

Properties worth knowing before you edit it:

- **Config, never a request header.** `Host` / `x-forwarded-host` are attacker-supplied in
  principle, and this value is written into account-wide storage config. Trusting a header
  would let a spoofed request add its own origin to the allowlist of an account holding PHI.
- **Ensure-inclusion, never remove.** It widens the allowlist; it never deletes an origin
  someone added by hand. Pruning is `scripts/set-blob-cors.sh`'s job.
- **Read-modify-write.** `setProperties` replaces the *entire* service-properties object,
  which also carries analytics logging, metrics, delete-retention and static-website config.
  A bare `setProperties({ cors })` would wipe them.
- **Memoised and non-throwing.** At most one round trip per instance; zero writes in the
  steady state. A failure logs and lets the share proceed — the rule may already be correct.
- **Requires Shared Key auth.** `Set Blob Service Properties` is not available to a scoped
  SAS or an RBAC identity. If `AZURE_STORAGE_ACCOUNT_KEY` is ever replaced, this degrades to
  a logged warning and the script becomes the mechanism.

### Optional escape hatch

`AZURE_STORAGE_CORS_EXTRA_ORIGINS` — comma-separated absolute origins, for a second bound
hostname or a staging slot. Not currently set in production; the `*.azurewebsites.net`
fallback host is covered by the rule the script writes, and the guard leaves it alone.

## Checking it by hand

The preflight is unauthenticated, so this reproduces the exact browser request with no SAS,
no login and no file:

```bash
curl -si -X OPTIONS -H "Origin: https://physician.health-assist.org" -H "Access-Control-Request-Method: PUT" -H "Access-Control-Request-Headers: content-type,x-ms-blob-type" "https://healthassistaistorage.blob.core.windows.net/patient-documents/preflight-probe" | grep -iE "^HTTP|^access-control"
```

Healthy response: `200 OK` plus `Access-Control-Allow-Origin` echoing your origin. A `403`
with `CORSNotEnabled` means no rule matches.

To see the stored rules:

```bash
az storage cors list --services b --account-name healthassistaistorage -o table
```

Note `az storage cors` does **not** accept `--auth-mode login`; `--account-name` alone makes
the CLI resolve the account key via ARM.

Failed preflights are never cached, so a repair takes effect immediately — no restart, no
cache flush.

## Current production state

Storage account `healthassistaistorage` (RG `healthassist-ai-prod`), container
`patient-documents`. One rule:

| Field | Value |
|---|---|
| AllowedOrigins | `https://physician.health-assist.org`, `https://healt-assist-ai-prod-f0bce3hwfhdrbvgr.canadacentral-01.azurewebsites.net` |
| AllowedMethods | `GET, HEAD, PUT, OPTIONS` |
| AllowedHeaders | `*` |
| ExposedHeaders | `*` |
| MaxAgeInSeconds | `3600` |

`AllowedHeaders: *` because the SAS is the credential — the header list is not a security
boundary, and `*` means adding an `x-ms-*` header to the upload later cannot silently break
preflight again. `ExposedHeaders: *` is what lets the client read `x-ms-request-id` off a
failed PUT and show it in the error banner. Keep max-age at 3600 so the next repair takes
effect within an hour rather than a day.

Azure allows a **maximum of 5 CORS rules** per service per account.

## Why this is not in Bicep

`infrastructure/main.bicep` has no `Microsoft.Storage` resource; the account predates the
IaC and is in a different resource group (`healthassist-ai-prod` vs `rg-health-assist-prod`).
Adopting it would mean declaring a `blobServices/default` child resource — and that is a full
PUT of the service-properties object, so declaring only `cors` can silently reset
`deleteRetentionPolicy` and disable soft-delete on an account holding PHI. That is a worse
failure than the one being prevented. `infra-deploy.yml` is also `workflow_dispatch`-only, so
it would not remove the "someone has to remember" problem anyway.
