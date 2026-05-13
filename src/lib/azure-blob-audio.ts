import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} from "@azure/storage-blob";
import { ensureProdEnv } from "@/lib/required-env";

function getAzureBlobConfig() {
  ensureProdEnv([
    "AZURE_STORAGE_ACCOUNT_NAME",
    "AZURE_STORAGE_ACCOUNT_KEY",
    "AZURE_STORAGE_AUDIO_CONTAINER",
  ]);

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
  const containerName =
    process.env.AZURE_STORAGE_AUDIO_CONTAINER || "audio-recordings";

  if (!accountName || !accountKey) {
    throw new Error(
      "Azure Blob Storage is not configured. Set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY.",
    );
  }

  return { accountName, accountKey, containerName };
}

export async function uploadAudioBlob(params: {
  blobName: string;
  wavBuffer: Buffer;
}): Promise<string> {
  const { accountName, accountKey, containerName } = getAzureBlobConfig();
  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential,
  );
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(params.blobName);

  await blockBlobClient.uploadData(params.wavBuffer, {
    blobHTTPHeaders: { blobContentType: "audio/wav" },
  });

  return params.blobName;
}

export async function generateAudioSasUrl(
  blobPath: string,
  ttlHours = 1,
): Promise<string> {
  const { accountName, accountKey, containerName } = getAzureBlobConfig();
  const credential = new StorageSharedKeyCredential(accountName, accountKey);

  const expiresOn = new Date(Date.now() + ttlHours * 3600 * 1000);
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

export async function deleteAudioBlob(blobPath: string): Promise<void> {
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
    console.error("[azure-blob-audio] deleteAudioBlob failed:", blobPath, err);
  }
}
