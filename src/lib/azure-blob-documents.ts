import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  type CorsRule,
} from "@azure/storage-blob";
import { ensureProdEnv } from "@/lib/required-env";

function getAzureBlobConfig() {
  // Only the account credentials are required in prod — the container name
  // defaults to "patient-documents" and is auto-created on first upload, so no
  // extra Azure app setting is needed to ship this feature.
  ensureProdEnv([
    "AZURE_STORAGE_ACCOUNT_NAME",
    "AZURE_STORAGE_ACCOUNT_KEY",
  ]);

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
  const containerName =
    process.env.AZURE_STORAGE_DOCUMENTS_CONTAINER || "patient-documents";

  if (!accountName || !accountKey) {
    throw new Error(
      "Azure Blob Storage is not configured. Set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY.",
    );
  }

  return { accountName, accountKey, containerName };
}

export async function uploadDocumentBlob(params: {
  blobName: string;
  buffer: Buffer;
  contentType: string;
}): Promise<string> {
  const { accountName, accountKey, containerName } = getAzureBlobConfig();
  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential,
  );
  const containerClient = blobServiceClient.getContainerClient(containerName);
  // Create the container on first use so a fresh storage account needs no manual step.
  await containerClient.createIfNotExists();
  const blockBlobClient = containerClient.getBlockBlobClient(params.blobName);

  await blockBlobClient.uploadData(params.buffer, {
    blobHTTPHeaders: { blobContentType: params.contentType },
  });

  return params.blobName;
}

/**
 * Read-only, time-limited SAS URL for a stored document, so the dashboard can
 * view/download it without the container being public. Short TTL by default.
 */
export async function generateDocumentSasUrl(
  blobPath: string,
  ttlMinutes = 15,
): Promise<string> {
  const { accountName, accountKey, containerName } = getAzureBlobConfig();
  const credential = new StorageSharedKeyCredential(accountName, accountKey);

  const expiresOn = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("r"),
      expiresOn,
    },
    credential,
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobPath}?${sasToken}`;
}

/**
 * Write-only, time-limited SAS URL for a single blob path, so the browser can upload
 * a large file (up to ~200 MB) directly to Azure Blob — bypassing the Next.js / Azure
 * Web App request-size limit. Scoped to one blob, create+write permissions only.
 *
 * NOTE: a direct browser→Azure PUT requires a blob CORS rule on the storage *account*
 * naming this app's exact origin. ensureDocumentsCors() below guarantees that at runtime;
 * scripts/set-blob-cors.sh and docs/azure-blob-cors.md are the out-of-band equivalents.
 */
export async function generateDocumentWriteSasUrl(
  blobPath: string,
  ttlMinutes = 30,
): Promise<string> {
  const { accountName, accountKey, containerName } = getAzureBlobConfig();
  const credential = new StorageSharedKeyCredential(accountName, accountKey);

  const expiresOn = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("cw"),
      expiresOn,
    },
    credential,
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobPath}?${sasToken}`;
}

/** True if a blob exists — used to confirm a browser direct-upload actually landed. */
export async function documentBlobExists(blobPath: string): Promise<boolean> {
  const { accountName, accountKey, containerName } = getAzureBlobConfig();
  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential,
  );
  const containerClient = blobServiceClient.getContainerClient(containerName);
  return containerClient.getBlockBlobClient(blobPath).exists();
}

export async function deleteDocumentBlob(blobPath: string): Promise<void> {
  try {
    const { accountName, accountKey, containerName } = getAzureBlobConfig();
    const credential = new StorageSharedKeyCredential(accountName, accountKey);
    const blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      credential,
    );
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    await blockBlobClient.deleteIfExists();
  } catch (err) {
    console.error("[azure-blob-documents] deleteDocumentBlob failed:", blobPath, err);
  }
}

// ── Browser-direct-upload CORS ───────────────────────────────────────────────
//
// The outbound "Send files" flow has the *browser* PUT straight to Azure via a write-SAS,
// so the storage account must carry a CORS rule naming this app's exact origin. That is
// account-wide service config, outside anything this repo deploys — and when the dashboard
// moved from mymd.health-assist.org to physician.health-assist.org the rule kept pointing at
// the old host. Every upload then died on a preflight 403 that the server never sees.
//
// Same philosophy as createIfNotExists() above: let the runtime provision its own
// prerequisite. The origin comes from NEXT_PUBLIC_APP_URL — already the source of truth for
// every link this app emits — so the allowlist cannot drift from the real domain: you cannot
// move the domain without changing that variable, and changing it repairs CORS on the next
// share. The silent failure is welded to a loud one.

const CORS_METHODS = "GET,HEAD,PUT,OPTIONS";
// The SAS is the credential; the header allowlist is not a security boundary. "*" means
// adding an x-ms-* header to the upload later can never silently break preflight again.
const CORS_ALLOWED_HEADERS = "*";
// Exposing everything is what lets the client read x-ms-request-id off a failed PUT.
const CORS_EXPOSED_HEADERS = "*";
const CORS_MAX_AGE_SECONDS = 3600;
const AZURE_MAX_CORS_RULES = 5; // hard service limit, per service, per account
const CORS_RETRY_BACKOFF_MS = 10 * 60 * 1000;

/** Headers the browser actually sends on the direct upload (see putToAzure). */
const REQUIRED_CORS_HEADERS = ["content-type", "x-ms-blob-type"];

function splitList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Origins the storage account should accept browser uploads from.
 *
 * Deliberately NOT derived from Host / x-forwarded-host. Those are attacker-supplied in
 * principle, and this value is written into ACCOUNT-WIDE storage config: a spoofed Host would
 * let anyone add their own origin to the CORS allowlist of an account holding PHI, turning a
 * leaked SAS into a browser-readable one. Config only, never a request header.
 */
export function getDocumentsCorsOrigins(): string[] {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL || "",
    // Escape hatch for a second bound hostname (the *.azurewebsites.net default host, a
    // staging slot). Comma-separated absolute origins.
    ...splitList(process.env.AZURE_STORAGE_CORS_EXTRA_ORIGINS),
  ];

  const origins: string[] = [];
  for (const candidate of candidates) {
    const value = candidate.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      // https only, except localhost for dev. Anything else is a misconfiguration, and we
      // would rather do nothing than widen a PHI account's allowlist on a typo.
      if (url.protocol !== "https:" && url.hostname !== "localhost") continue;
      const origin = url.origin; // drops path/query, normalises case and default port
      if (!origins.includes(origin)) origins.push(origin);
    } catch {
      continue;
    }
  }
  return origins;
}

/**
 * True if this rule would actually let the browser upload: it must permit PUT and must not
 * block the two headers putToAzure sets.
 *
 * OPTIONS is deliberately not required — Azure matches a preflight on the value of
 * Access-Control-Request-Method (PUT), so demanding OPTIONS as well would rewrite rules that
 * already work perfectly.
 */
function ruleIsAdequate(rule: CorsRule): boolean {
  const methods = splitList(rule.allowedMethods).map((m) => m.toUpperCase());
  if (!methods.includes("PUT")) return false;

  const headers = splitList(rule.allowedHeaders).map((h) => h.toLowerCase());
  if (headers.includes("*")) return true;
  return REQUIRED_CORS_HEADERS.every((required) =>
    // Azure supports "prefix*" wildcards in the header list.
    headers.some((h) => (h.endsWith("*") ? required.startsWith(h.slice(0, -1)) : h === required)),
  );
}

/**
 * Pure merge step, exported for tests: returns the rule array to write, or null when the
 * account already works (the steady state — zero writes, so the read-modify-write race
 * window against a human editing the portal is ~once per domain change).
 *
 * Ensure-inclusion, never remove. An exact-equality check would compute the desired set from
 * NEXT_PUBLIC_APP_URL alone and silently drop any extra origin an operator had added by hand.
 * Pruning stale origins is scripts/set-blob-cors.sh's job, not the app's.
 */
export function mergeDocumentsCorsRules(
  existing: CorsRule[],
  desiredOrigins: string[],
): CorsRule[] | null {
  const covered = new Set(
    existing
      .filter(ruleIsAdequate)
      .flatMap((rule) => splitList(rule.allowedOrigins).map((o) => o.toLowerCase())),
  );
  const missing = desiredOrigins.filter(
    (o) => !covered.has("*") && !covered.has(o.toLowerCase()),
  );
  if (!missing.length) return null;

  // Prefer widening a rule we already own over appending — the account has a hard 5-rule
  // limit, and one rule per domain move would exhaust it.
  const targetIndex = existing.findIndex(
    (rule) => ruleIsAdequate(rule) && rule.allowedHeaders.trim() === CORS_ALLOWED_HEADERS,
  );

  if (targetIndex >= 0) {
    const target = existing[targetIndex];
    const merged: CorsRule = {
      ...target,
      allowedOrigins: [...splitList(target.allowedOrigins), ...missing].join(","),
      maxAgeInSeconds: Math.max(target.maxAgeInSeconds, CORS_MAX_AGE_SECONDS),
    };
    return existing.map((rule, i) => (i === targetIndex ? merged : rule));
  }

  return [
    ...existing,
    {
      allowedOrigins: missing.join(","),
      allowedMethods: CORS_METHODS,
      allowedHeaders: CORS_ALLOWED_HEADERS,
      exposedHeaders: CORS_EXPOSED_HEADERS,
      maxAgeInSeconds: CORS_MAX_AGE_SECONDS,
    },
  ];
}

let corsEnsurePromise: Promise<void> | null = null;
let corsEnsureFailedAt = 0;

async function applyDocumentsCors(): Promise<void> {
  const desiredOrigins = getDocumentsCorsOrigins();
  if (!desiredOrigins.length) {
    console.warn(
      "[azure-blob-documents] NEXT_PUBLIC_APP_URL is unset or not an absolute https URL — " +
        "cannot verify blob CORS. Browser uploads will fail if the account has no rule for " +
        "this site's origin.",
    );
    return;
  }

  const { accountName, accountKey } = getAzureBlobConfig();
  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const service = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential,
  );

  // MUST be read-modify-write. setProperties replaces the whole service-properties object,
  // which also carries analytics logging, hour/minute metrics, delete-retention and the
  // static-website config — a bare setProperties({ cors }) would wipe all of them.
  const props = await service.getProperties();
  const existing = props.cors ?? [];
  const next = mergeDocumentsCorsRules(existing, desiredOrigins);
  if (!next) return;

  if (next.length > AZURE_MAX_CORS_RULES) {
    console.error(
      `[azure-blob-documents] Cannot add a CORS rule for ${desiredOrigins.join(", ")}: the ` +
        `account is at Azure's ${AZURE_MAX_CORS_RULES}-rule limit. Prune with scripts/set-blob-cors.sh.`,
    );
    return;
  }

  await service.setProperties({
    blobAnalyticsLogging: props.blobAnalyticsLogging,
    hourMetrics: props.hourMetrics,
    minuteMetrics: props.minuteMetrics,
    defaultServiceVersion: props.defaultServiceVersion,
    deleteRetentionPolicy: props.deleteRetentionPolicy,
    staticWebsite: props.staticWebsite,
    cors: next,
  });

  // console.warn, not logDebug: logDebug is a no-op in production (see secure-logger.ts), and
  // this line is the whole point — the production-visible signal that the allowlist had
  // drifted. Expect it exactly once after a domain change.
  console.warn(
    `[azure-blob-documents] Blob CORS updated for ${desiredOrigins.join(", ")} ` +
      `(previous origins: ${existing.map((r) => r.allowedOrigins).join(" | ") || "none"}). ` +
      "If this appears on every cold start, the write is not sticking — check the credential.",
  );
}

/**
 * Guarantee a blob CORS rule exists for this app's own origin(s). Memoised as a promise so
 * concurrent share creates on one instance share a single round trip, and so the steady state
 * costs nothing after the first call.
 *
 * Concurrency across App Service instances is safe by construction: every instance reads the
 * same NEXT_PUBLIC_APP_URL and computes the same rule array, so a racing write is convergent
 * rather than duplicating. (The duplicate rules found in prod came from repeated
 * `az storage cors add`, which appends — this merge replaces.)
 *
 * Best-effort by design: never throws into the caller. If the credential cannot write service
 * properties — e.g. the account key is later swapped for a container-scoped SAS or an RBAC
 * identity, neither of which can call Set Blob Service Properties — the rule may already be
 * correct from scripts/set-blob-cors.sh, and failing the share would turn a config warning
 * into an outage.
 */
export async function ensureDocumentsCors(): Promise<void> {
  if (!corsEnsurePromise) {
    if (corsEnsureFailedAt && Date.now() - corsEnsureFailedAt < CORS_RETRY_BACKOFF_MS) return;
    corsEnsurePromise = applyDocumentsCors().catch((err) => {
      // Runs strictly after the assignment above, so clearing the memo here is safe: it lets
      // one retry through per backoff window instead of hammering on every share.
      corsEnsureFailedAt = Date.now();
      corsEnsurePromise = null;
      console.error(
        "[azure-blob-documents] Could not verify/update blob CORS — browser uploads may fail " +
          "on a preflight 403. Fix out-of-band with scripts/set-blob-cors.sh:",
        err,
      );
    });
  }
  return corsEnsurePromise;
}
