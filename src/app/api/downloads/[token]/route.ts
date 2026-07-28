/**
 * Public (token + passphrase authenticated) secure file download.
 *   GET  /api/downloads/[token]  → validity + clinic name + file count (no files, no SAS)
 *   POST /api/downloads/[token]  → { passphrase } in body → verifies, returns files with
 *                                  short-lived read-SAS download URLs.
 *
 * No login: the unguessable token + passphrase are the credentials. The passphrase is
 * only ever accepted in the POST body (never a query string). Brute force is rate-limited.
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { hashDocumentToken } from "@/lib/document-token";
import { generateDocumentSasUrl } from "@/lib/azure-blob-documents";
import { consumeRateLimit } from "@/lib/invitation-security";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

interface ShareRow {
  id: string;
  organization_id: string;
  recipient_name: string | null;
  passphrase_hash: string;
  expires_at: string;
  revoked_at: string | null;
  completed_at: string | null;
}

async function loadShare(rawToken: string): Promise<ShareRow | null> {
  const hash = hashDocumentToken(rawToken);
  const result = await query<ShareRow>(
    `SELECT id, organization_id, recipient_name, passphrase_hash,
            expires_at, revoked_at, completed_at
     FROM document_shares
     WHERE token_hash = $1`,
    [hash],
  );
  return result.rows[0] ?? null;
}

function shareState(s: ShareRow): "valid" | "revoked" | "expired" | "pending" {
  if (s.revoked_at) return "revoked";
  if (new Date(s.expires_at).getTime() < Date.now()) return "expired";
  if (!s.completed_at) return "pending"; // files not finished uploading yet
  return "valid";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const { token } = await params;

  try {
    const share = await loadShare(token);
    if (!share) {
      logRequestMeta("/api/downloads", requestId, 404, Date.now() - started);
      return NextResponse.json({ valid: false, state: "not_found" }, { status: 404 });
    }

    const orgResult = await query<{ name: string }>(
      `SELECT name FROM organizations WHERE id = $1`,
      [share.organization_id],
    );
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM document_share_files
       WHERE share_id = $1 AND deleted_at IS NULL`,
      [share.id],
    );

    const state = shareState(share);
    logRequestMeta("/api/downloads", requestId, 200, Date.now() - started);
    return NextResponse.json({
      valid: state === "valid",
      state,
      clinicName: orgResult.rows[0]?.name ?? "the clinic",
      recipientName: share.recipient_name,
      fileCount: Number(countResult.rows[0]?.count ?? 0),
      requiresPassphrase: true,
    });
  } catch (error) {
    console.error("[api/downloads GET] Error:", error);
    logRequestMeta("/api/downloads", requestId, 500, Date.now() - started);
    return NextResponse.json({ valid: false, state: "error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const { token } = await params;

  try {
    const share = await loadShare(token);
    if (!share) {
      logRequestMeta("/api/downloads", requestId, 404, Date.now() - started);
      return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
    }

    const state = shareState(share);
    if (state !== "valid") {
      const message =
        state === "expired"
          ? "This link has expired. Please contact the sender for a new one."
          : state === "revoked"
            ? "This link has been revoked by the sender."
            : "These files are not ready yet. Please try again shortly.";
      logRequestMeta("/api/downloads", requestId, 410, Date.now() - started);
      return NextResponse.json({ error: message }, { status: 410 });
    }

    // Rate-limit passphrase attempts per link to block brute force.
    const rl = await consumeRateLimit(`downloads:${hashDocumentToken(token)}`, 10, 600);
    if (!rl.allowed) {
      logRequestMeta("/api/downloads", requestId, 429, Date.now() - started);
      return NextResponse.json(
        { error: "Too many attempts. Please try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const body = await request.json().catch(() => ({}));
    const passphrase = (body?.passphrase as string | undefined) ?? "";
    const ok = passphrase ? await verifyPassword(passphrase, share.passphrase_hash) : false;
    if (!ok) {
      logRequestMeta("/api/downloads", requestId, 401, Date.now() - started);
      return NextResponse.json({ error: "Incorrect passphrase." }, { status: 401 });
    }

    const filesResult = await query<{
      id: string;
      blob_path: string;
      original_filename: string | null;
      content_type: string | null;
      size_bytes: string | null;
    }>(
      `SELECT id, blob_path, original_filename, content_type, size_bytes
       FROM document_share_files
       WHERE share_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [share.id],
    );

    const files = await Promise.all(
      filesResult.rows.map(async (f) => ({
        id: f.id,
        filename: f.original_filename,
        contentType: f.content_type,
        sizeBytes: f.size_bytes ? Number(f.size_bytes) : null,
        downloadUrl: await generateDocumentSasUrl(f.blob_path, 15),
      })),
    );

    await query(
      `UPDATE document_shares
       SET download_count = download_count + 1, last_downloaded_at = NOW()
       WHERE id = $1`,
      [share.id],
    );

    logRequestMeta("/api/downloads", requestId, 200, Date.now() - started);
    return NextResponse.json({ success: true, files });
  } catch (error) {
    console.error("[api/downloads POST] Error:", error);
    logRequestMeta("/api/downloads", requestId, 500, Date.now() - started);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
