/**
 * GET /api/org/documents/files/[fileId]
 * Redirects an authenticated org admin to a fresh short-lived signed (SAS) URL
 * for one uploaded document. Access is scoped to the caller's organization, so
 * a guessed file id from another org is rejected.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { generateDocumentSasUrl } from "@/lib/azure-blob-documents";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const { fileId } = await params;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/documents/files", requestId, status, Date.now() - started);
      return res;
    }

    const result = await query<{ blob_path: string }>(
      `SELECT f.blob_path
       FROM patient_document_files f
       JOIN patient_document_requests r ON r.id = f.request_id
       WHERE f.id = $1 AND f.deleted_at IS NULL AND r.organization_id = $2`,
      [fileId, session.organizationId],
    );

    if (!result.rows.length) {
      status = 404;
      const res = NextResponse.json({ error: "File not found" }, { status });
      logRequestMeta("/api/org/documents/files", requestId, status, Date.now() - started);
      return res;
    }

    const sasUrl = await generateDocumentSasUrl(result.rows[0].blob_path, 15);
    logRequestMeta("/api/org/documents/files", requestId, 302, Date.now() - started);
    return NextResponse.redirect(sasUrl);
  } catch (error) {
    console.error("[api/org/documents/files] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/documents/files", requestId, status, Date.now() - started);
    return res;
  }
}
