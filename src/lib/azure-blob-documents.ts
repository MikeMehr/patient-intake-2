import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
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
 * NOTE: direct browser→Azure PUT requires a CORS rule on the storage account allowing
 * PUT/OPTIONS/HEAD from the app origin (see azure-cors setup docs).
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
