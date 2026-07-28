/**
 * POST /api/org/documents/shares/[id]/revoke
 * Kills a share link early. Org-scoped: a share id from another org is rejected.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

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
      logRequestMeta("/api/org/documents/shares/revoke", requestId, status, Date.now() - started);
      return res;
    }

    const result = await query<{ id: string }>(
      `UPDATE document_shares SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE id = $1 AND organization_id = $2
       RETURNING id`,
      [id, session.organizationId],
    );

    if (!result.rows.length) {
      status = 404;
      const res = NextResponse.json({ error: "Share not found" }, { status });
      logRequestMeta("/api/org/documents/shares/revoke", requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({ success: true });
    logRequestMeta("/api/org/documents/shares/revoke", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/org/documents/shares/revoke] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/documents/shares/revoke", requestId, status, Date.now() - started);
    return res;
  }
}
