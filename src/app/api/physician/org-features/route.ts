import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

async function hasWoundCareColumn(): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'organizations'
         AND column_name = 'wound_care'
     ) AS exists`,
  );
  return Boolean(result.rows[0]?.exists);
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json({ woundCare: false }, { status });
      logRequestMeta("/api/physician/org-features", requestId, status, Date.now() - started);
      return res;
    }

    const orgId = session.organizationId;
    if (!orgId) {
      const res = NextResponse.json({ woundCare: false });
      logRequestMeta("/api/physician/org-features", requestId, status, Date.now() - started);
      return res;
    }

    const supportsColumn = await hasWoundCareColumn();
    if (!supportsColumn) {
      const res = NextResponse.json({ woundCare: false });
      logRequestMeta("/api/physician/org-features", requestId, status, Date.now() - started);
      return res;
    }

    const result = await query<{ wound_care: boolean }>(
      `SELECT wound_care FROM organizations WHERE id = $1 LIMIT 1`,
      [orgId],
    );

    const woundCare = Boolean(result.rows[0]?.wound_care);
    const res = NextResponse.json({ woundCare });
    logRequestMeta("/api/physician/org-features", requestId, status, Date.now() - started);
    return res;
  } catch {
    logRequestMeta("/api/physician/org-features", requestId, 500, Date.now() - started);
    return NextResponse.json({ woundCare: false });
  }
}
