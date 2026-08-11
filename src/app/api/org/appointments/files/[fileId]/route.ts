/**
 * GET /api/org/appointments/files/[fileId]
 * Redirects an authenticated org admin to a fresh short-lived signed (SAS) URL for
 * one file a patient attached to their booking. Scoped to the caller's organization,
 * so a guessed file id from another org is rejected.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getOrgAdminContext } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { generateDocumentSasUrl } from "@/lib/azure-blob-documents";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const { fileId } = await params;

  try {
    const session = await getCurrentSession();
    const orgContext = await getOrgAdminContext(session);
    if (!orgContext) {
      logRequestMeta("/api/org/appointments/files", requestId, 401, Date.now() - started);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await query<{ blob_path: string }>(
      `SELECT f.blob_path
       FROM appointment_files f
       JOIN appointments a ON a.id = f.appointment_id
       WHERE f.id = $1 AND a.organization_id = $2`,
      [fileId, orgContext.organizationId],
    );

    if (!result.rows.length) {
      logRequestMeta("/api/org/appointments/files", requestId, 404, Date.now() - started);
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const sasUrl = await generateDocumentSasUrl(result.rows[0].blob_path, 15);
    logRequestMeta("/api/org/appointments/files", requestId, 302, Date.now() - started);
    return NextResponse.redirect(sasUrl);
  } catch (error) {
    console.error("[api/org/appointments/files] Error:", error);
    logRequestMeta("/api/org/appointments/files", requestId, 500, Date.now() - started);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
