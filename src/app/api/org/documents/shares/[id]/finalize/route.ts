/**
 * POST /api/org/documents/shares/[id]/finalize
 * Called after the browser has uploaded every file directly to Azure. Confirms the
 * blobs landed, marks the share ready, and — if a recipient email was given — sends
 * the secure link (link only; the passphrase is shared out-of-band).
 *
 * The client passes back the raw token it received from the create call; the server
 * verifies it hashes to this share's stored token_hash (proof of possession) and uses
 * it to build the download URL, since only the hash is persisted.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { hashDocumentToken } from "@/lib/document-token";
import { documentBlobExists } from "@/lib/azure-blob-documents";
import { sendDocumentShareEmail } from "@/lib/booking-email";
import { resolveAppUrl } from "@/lib/app-url";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

interface ShareRow {
  id: string;
  token_hash: string;
  recipient_name: string | null;
  recipient_email: string | null;
  expires_at: string;
  revoked_at: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const { id } = await params;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/documents/shares/finalize", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json().catch(() => ({}));
    const token = (body?.token as string | undefined) ?? "";

    const shareResult = await query<ShareRow>(
      `SELECT id, token_hash, recipient_name, recipient_email, expires_at, revoked_at
       FROM document_shares
       WHERE id = $1 AND organization_id = $2`,
      [id, session.organizationId],
    );
    if (!shareResult.rows.length) {
      status = 404;
      const res = NextResponse.json({ error: "Share not found" }, { status });
      logRequestMeta("/api/org/documents/shares/finalize", requestId, status, Date.now() - started);
      return res;
    }
    const share = shareResult.rows[0];

    if (!token || hashDocumentToken(token) !== share.token_hash) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid share token." }, { status });
      logRequestMeta("/api/org/documents/shares/finalize", requestId, status, Date.now() - started);
      return res;
    }

    // Confirm every file's blob actually landed in Azure before publishing the link.
    const filesResult = await query<{ id: string; blob_path: string }>(
      `SELECT id, blob_path FROM document_share_files
       WHERE share_id = $1 AND deleted_at IS NULL`,
      [share.id],
    );
    if (!filesResult.rows.length) {
      status = 400;
      const res = NextResponse.json({ error: "No files to finalize." }, { status });
      logRequestMeta("/api/org/documents/shares/finalize", requestId, status, Date.now() - started);
      return res;
    }

    for (const f of filesResult.rows) {
      const exists = await documentBlobExists(f.blob_path);
      if (!exists) {
        status = 409;
        const res = NextResponse.json(
          { error: "Some files did not finish uploading. Please try again." },
          { status },
        );
        logRequestMeta("/api/org/documents/shares/finalize", requestId, status, Date.now() - started);
        return res;
      }
    }

    await query(
      `UPDATE document_share_files SET uploaded_confirmed_at = NOW()
       WHERE share_id = $1 AND uploaded_confirmed_at IS NULL`,
      [share.id],
    );
    await query(
      `UPDATE document_shares SET completed_at = COALESCE(completed_at, NOW())
       WHERE id = $1`,
      [share.id],
    );

    const downloadUrl = `${resolveAppUrl(request)}/download/${token}`;

    let emailSent = false;
    if (share.recipient_email) {
      const orgResult = await query<{
        name: string;
        email: string | null;
        email_footer: string | null;
      }>(
        `SELECT o.name, o.email, bs.email_footer
         FROM organizations o
         LEFT JOIN booking_settings bs ON bs.organization_id = o.id
         WHERE o.id = $1`,
        [session.organizationId],
      );
      const org = orgResult.rows[0];
      if (org) {
        const emailResult = await sendDocumentShareEmail({
          email: share.recipient_email,
          recipientName: share.recipient_name,
          clinicName: org.name,
          downloadUrl,
          expiresAt: new Date(share.expires_at),
          emailFooter: org.email_footer,
          clinicEmail: org.email,
        });
        emailSent = emailResult.sent;
      }
    }

    const res = NextResponse.json({ success: true, downloadUrl, emailSent });
    logRequestMeta("/api/org/documents/shares/finalize", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/org/documents/shares/finalize] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/documents/shares/finalize", requestId, status, Date.now() - started);
    return res;
  }
}
