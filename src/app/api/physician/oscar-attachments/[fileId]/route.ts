/**
 * GET /api/physician/oscar-attachments/[fileId]
 *
 * The raw bytes of one booking attachment, for the physician popup to hand to
 * the OSCAR page. Bytes rather than the SAS redirect used elsewhere: the popup
 * has to put the actual content into a postMessage payload, and a redirect to
 * blob storage can't be read cross-origin.
 *
 * Scoped to the caller's organization, so a guessed file id from another clinic
 * is a 404.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { generateDocumentSasUrl } from "@/lib/azure-blob-documents";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";

export const runtime = "nodejs";

const ROUTE = "/api/physician/oscar-attachments/[fileId]";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const { fileId } = await params;

  try {
    const session = await getCurrentSession();
    if (!session) {
      logRequestMeta(ROUTE, requestId, 401, Date.now() - started);
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    if (session.userType !== "provider" || !session.organizationId) {
      logRequestMeta(ROUTE, requestId, 403, Date.now() - started);
      return NextResponse.json({ error: "Provider access required." }, { status: 403 });
    }

    const result = await query<{
      blob_path: string;
      original_filename: string | null;
      content_type: string | null;
      oscar_demographic_no: string | null;
    }>(
      `SELECT f.blob_path, f.original_filename, f.content_type, a.oscar_demographic_no
       FROM appointment_files f
       JOIN appointments a ON a.id = f.appointment_id
       WHERE f.id = $1 AND a.organization_id = $2`,
      [fileId, session.organizationId],
    );

    const row = result.rows[0];
    if (!row) {
      logRequestMeta(ROUTE, requestId, 404, Date.now() - started);
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Streamed through this route rather than redirected, so the popup can read the
    // bytes. Fetched server-side from a short-lived SAS URL — the container stays private.
    const sasUrl = await generateDocumentSasUrl(row.blob_path, 5);
    const upstream = await fetch(sasUrl);
    if (!upstream.ok) {
      console.error(`[${ROUTE}] Blob fetch failed ${upstream.status} for ${fileId}`);
      logRequestMeta(ROUTE, requestId, 502, Date.now() - started);
      return NextResponse.json({ error: "Could not read the stored file." }, { status: 502 });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());

    await logPhysicianPhiAudit({
      physicianId: getEffectivePhysicianId(session),
      eventType: "oscar_attachment_bytes_read",
      ipAddress: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        fileId,
        demographicNo: row.oscar_demographic_no,
        filename: row.original_filename,
      },
    }).catch(() => {});

    logRequestMeta(ROUTE, requestId, 200, Date.now() - started);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": row.content_type || "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[${ROUTE}] Error:`, error);
    logRequestMeta(ROUTE, requestId, 500, Date.now() - started);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
