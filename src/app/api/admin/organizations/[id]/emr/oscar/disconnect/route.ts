import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "super_admin") {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/admin/organizations/[id]/emr/oscar/disconnect", requestId, status, Date.now() - started);
      return res;
    }

    const { id: orgId } = await params;
    await query(
      `UPDATE emr_connections
       SET access_token_enc = NULL,
           token_secret_enc = NULL,
           status = 'not_connected',
           updated_at = NOW()
       WHERE organization_id = $1 AND vendor = 'OSCAR'`,
      [orgId],
    );

    const res = NextResponse.json({ success: true });
    logRequestMeta("/api/admin/organizations/[id]/emr/oscar/disconnect", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/emr/oscar/disconnect] Error", error);
    const res = NextResponse.json({ error: "Failed to disconnect OSCAR" }, { status });
    logRequestMeta("/api/admin/organizations/[id]/emr/oscar/disconnect", requestId, status, Date.now() - started);
    return res;
  }
}

