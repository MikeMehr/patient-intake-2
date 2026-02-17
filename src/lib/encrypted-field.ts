import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

type EncryptedPayloadV1 = {
  v: 1;
  alg: "aes-256-gcm";
  iv: string; // base64
  tag: string; // base64
  data: string; // base64
};

function getEmrEncryptionKey(): Buffer {
  const raw = process.env.EMR_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("EMR_ENCRYPTION_KEY is required for EMR credential storage");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("EMR_ENCRYPTION_KEY must be 32 bytes base64-encoded");
  }
  return buf;
}

export function encryptString(plaintext: string): string {
  const key = getEmrEncryptionKey();
  const iv = randomBytes(12); // GCM standard IV size
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayloadV1 = {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
  };
  return JSON.stringify(payload);
}

export function decryptString(payload: string): string {
  const key = getEmrEncryptionKey();
  let parsed: EncryptedPayloadV1;
  try {
    parsed = JSON.parse(payload) as EncryptedPayloadV1;
  } catch {
    throw new Error("Invalid encrypted payload");
  }
  if (!parsed || parsed.v !== 1 || parsed.alg !== "aes-256-gcm") {
    throw new Error("Unsupported encrypted payload");
  }

  const iv = Buffer.from(parsed.iv, "base64");
  const tag = Buffer.from(parsed.tag, "base64");
  const data = Buffer.from(parsed.data, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString("utf8");
}

export function maskSecret(secret: string, keepLast = 4): string {
  const clean = secret.trim();
  if (clean.length <= keepLast) return "*".repeat(Math.max(4, clean.length));
  return `${"*".repeat(Math.max(8, clean.length - keepLast))}${clean.slice(-keepLast)}`;
}

