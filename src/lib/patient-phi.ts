import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { ensureProdEnv } from "@/lib/required-env";

type EncryptedPayloadV1 = {
  v: 1;
  alg: "aes-256-gcm";
  iv: string; // base64
  tag: string; // base64
  data: string; // base64
};

function getPatientPhiEncryptionKey(): Buffer {
  ensureProdEnv(["PATIENT_PHI_ENCRYPTION_KEY"]);
  const raw = process.env.PATIENT_PHI_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("PATIENT_PHI_ENCRYPTION_KEY is required for patient PHI encryption");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("PATIENT_PHI_ENCRYPTION_KEY must be 32 bytes base64-encoded");
  }
  return buf;
}

function getHinHashPepper(): string {
  // Pepper is used only for hashing (lookup). Encryption key handles confidentiality.
  // We keep this separate so rotation strategies can be planned independently.
  ensureProdEnv(["PATIENT_HIN_HASH_PEPPER"]);
  const pepper = (process.env.PATIENT_HIN_HASH_PEPPER || "").trim();
  if (pepper) return pepper;

  // Non-production convenience: allows local dev to work without provisioning a pepper.
  // In production, ensureProdEnv() enforces that this is set.
  return "dev-pepper";
}

export function encryptPatientPhiString(plaintext: string): string {
  const key = getPatientPhiEncryptionKey();
  const iv = randomBytes(12);
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

export function decryptPatientPhiString(payload: string): string {
  const key = getPatientPhiEncryptionKey();
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

export function normalizeHin(raw: string): string {
  // Normalize for hashing and equality:
  // - trim
  // - remove whitespace and hyphens
  // - uppercase
  return String(raw || "")
    .trim()
    .replace(/[\s-]+/g, "")
    .toUpperCase();
}

export function computeHinHash(rawHin: string): string | null {
  const normalized = normalizeHin(rawHin);
  if (!normalized) return null;
  const pepper = getHinHashPepper();
  return createHash("sha256").update(`${normalized}:${pepper}`, "utf8").digest("hex");
}

export function maskHin(rawHin: string, keepLast = 4): string {
  const normalized = normalizeHin(rawHin);
  if (!normalized) return "";
  if (normalized.length <= keepLast) return "*".repeat(Math.max(4, normalized.length));
  return `${"*".repeat(normalized.length - keepLast)}${normalized.slice(-keepLast)}`;
}

