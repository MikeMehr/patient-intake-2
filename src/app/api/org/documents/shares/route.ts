/**
 * Outbound secure file sharing (clinic → recipient).
 *   GET  /api/org/documents/shares  → list this org's shares (for the dashboard)
 *   POST /api/org/documents/shares  → create a share: reserve blob paths + return
 *                                     per-file write-SAS URLs so the browser uploads
 *                                     large files directly to Azure.
 *
 * The passphrase is bcrypt-hashed; the link token is SHA-256 hashed. Neither is
 * stored in the clear. The raw token is returned once (over HTTPS) so the client can
 * build the link — it is never persisted.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getCurrentSession } from "@/lib/auth";
import { hashPassword } from "@/lib/auth";
import { query } from "@/lib/db";
import { consumeRateLimit } from "@/lib/invitation-security";
import { generateDocumentToken } from "@/lib/document-token";
import {
  generateDocumentWriteSasUrl,
  ensureDocumentsCors,
} from "@/lib/azure-blob-documents";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB each
const MIN_PASSPHRASE = 6;

interface IncomingFile {
  filename: string;
  contentType?: string;
  sizeBytes?: number;
}

function sanitizeFilename(name: string): string {
  return (name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120);
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
      return res;
    }

    const rl = await consumeRateLimit(`documents:share:${session.organizationId}`, 30, 600);
    if (!rl.allowed) {
      status = 429;
      const res = NextResponse.json(
        { error: "Too many shares created. Please try again later." },
        { status, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
      logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json().catch(() => ({}));
    const recipientName = (body?.recipientName as string | undefined)?.trim() || null;
    const recipientEmail = (body?.recipientEmail as string | undefined)?.trim() || null;
    const passphrase = (body?.passphrase as string | undefined) ?? "";
    const files = Array.isArray(body?.files) ? (body.files as IncomingFile[]) : [];

    if (passphrase.length < MIN_PASSPHRASE) {
      status = 400;
      const res = NextResponse.json(
        { error: `Passphrase must be at least ${MIN_PASSPHRASE} characters.` },
        { status },
      );
      logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
      return res;
    }

    if (!files.length) {
      status = 400;
      const res = NextResponse.json({ error: "Add at least one file." }, { status });
      logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
      return res;
    }
    if (files.length > MAX_FILES) {
      status = 400;
      const res = NextResponse.json(
        { error: `You can send at most ${MAX_FILES} files.` },
        { status },
      );
      logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
      return res;
    }
    for (const f of files) {
      if (!f?.filename) {
        status = 400;
        const res = NextResponse.json({ error: "Each file needs a name." }, { status });
        logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
        return res;
      }
      if (typeof f.sizeBytes === "number" && f.sizeBytes > MAX_FILE_BYTES) {
        status = 400;
        const res = NextResponse.json(
          { error: `"${f.filename}" is larger than the 200 MB limit.` },
          { status },
        );
        logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
        return res;
      }
    }

    if (recipientEmail && !EMAIL_REGEX.test(recipientEmail)) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid recipient email address." }, { status });
      logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
      return res;
    }

    const { raw, hash, expiresAt } = generateDocumentToken();
    const passphraseHash = await hashPassword(passphrase);

    const inserted = await query<{ id: string }>(
      `INSERT INTO document_shares
         (organization_id, created_by_user_id, recipient_name, recipient_email,
          token_hash, passphrase_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        session.organizationId,
        session.userId,
        recipientName,
        recipientEmail,
        hash,
        passphraseHash,
        expiresAt,
      ],
    );
    const shareId = inserted.rows[0].id;

    // These SAS URLs are PUT to by the *browser*, so the storage account needs a CORS rule
    // naming this app's origin. Memoised and non-throwing — see ensureDocumentsCors.
    await ensureDocumentsCors();

    const uploads: Array<{ fileId: string; writeSasUrl: string; contentType: string }> = [];
    for (const f of files) {
      const contentType = f.contentType || "application/octet-stream";
      const blobPath = `${session.organizationId}/shares/${shareId}/${randomBytes(8).toString("hex")}-${sanitizeFilename(f.filename)}`;
      const fileRow = await query<{ id: string }>(
        `INSERT INTO document_share_files
           (share_id, blob_path, original_filename, content_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [shareId, blobPath, f.filename, contentType, f.sizeBytes ?? null],
      );
      const writeSasUrl = await generateDocumentWriteSasUrl(blobPath, 30);
      uploads.push({ fileId: fileRow.rows[0].id, writeSasUrl, contentType });
    }

    const res = NextResponse.json({ success: true, shareId, token: raw, uploads });
    logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/org/documents/shares POST] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
    return res;
  }
}

interface ShareRow {
  id: string;
  recipient_name: string | null;
  recipient_email: string | null;
  expires_at: string;
  revoked_at: string | null;
  completed_at: string | null;
  download_count: number;
  last_downloaded_at: string | null;
  created_at: string;
}

interface ShareFileRow {
  id: string;
  share_id: string;
  original_filename: string | null;
  content_type: string | null;
  size_bytes: string | null;
  uploaded_confirmed_at: string | null;
}

function shareStatus(r: ShareRow): "revoked" | "expired" | "completed" | "pending" {
  if (r.revoked_at) return "revoked";
  if (r.completed_at) return "completed";
  if (new Date(r.expires_at).getTime() < Date.now()) return "expired";
  return "pending";
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
      return res;
    }

    const sharesResult = await query<ShareRow>(
      `SELECT id, recipient_name, recipient_email, expires_at, revoked_at, completed_at,
              download_count, last_downloaded_at, created_at
       FROM document_shares
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [session.organizationId],
    );

    const shares = sharesResult.rows;
    const ids = shares.map((s) => s.id);
    let filesByShare: Record<string, ShareFileRow[]> = {};
    if (ids.length) {
      const filesResult = await query<ShareFileRow>(
        `SELECT id, share_id, original_filename, content_type, size_bytes, uploaded_confirmed_at
         FROM document_share_files
         WHERE share_id = ANY($1) AND deleted_at IS NULL
         ORDER BY created_at ASC`,
        [ids],
      );
      filesByShare = filesResult.rows.reduce((acc, f) => {
        (acc[f.share_id] ??= []).push(f);
        return acc;
      }, {} as Record<string, ShareFileRow[]>);
    }

    const res = NextResponse.json({
      shares: shares.map((s) => ({
        id: s.id,
        recipientName: s.recipient_name,
        recipientEmail: s.recipient_email,
        status: shareStatus(s),
        expiresAt: s.expires_at,
        completedAt: s.completed_at,
        downloadCount: s.download_count,
        lastDownloadedAt: s.last_downloaded_at,
        createdAt: s.created_at,
        files: (filesByShare[s.id] ?? []).map((f) => ({
          id: f.id,
          filename: f.original_filename,
          contentType: f.content_type,
          sizeBytes: f.size_bytes ? Number(f.size_bytes) : null,
          confirmed: !!f.uploaded_confirmed_at,
        })),
      })),
    });
    logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/org/documents/shares GET] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/documents/shares", requestId, status, Date.now() - started);
    return res;
  }
}
