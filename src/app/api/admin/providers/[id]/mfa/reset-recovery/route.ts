import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { adminResetMfaRecovery } from "@/lib/auth-mfa";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

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
      const res = NextResponse.json(
        { error: "Unauthorized - Super admin access required" },
        { status },
      );
      logRequestMeta("/api/admin/providers/[id]/mfa/reset-recovery", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;
    const providerResult = await query<{ id: string }>(
      `SELECT id FROM physicians WHERE id = $1`,
      [id],
    );
    if (providerResult.rows.length === 0) {
      status = 404;
      const res = NextResponse.json({ error: "Provider not found" }, { status });
      logRequestMeta("/api/admin/providers/[id]/mfa/reset-recovery", requestId, status, Date.now() - started);
      return res;
    }

    const recovery = await adminResetMfaRecovery({
      userType: "provider",
      userId: id,
    });
    const res = NextResponse.json({ success: true, recovery });
    logRequestMeta("/api/admin/providers/[id]/mfa/reset-recovery", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/providers/[id]/mfa/reset-recovery] POST Error", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/admin/providers/[id]/mfa/reset-recovery", requestId, status, Date.now() - started);
    return res;
  }
}
