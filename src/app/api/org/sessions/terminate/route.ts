import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

type TerminateScope = "user" | "organization";

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
  );
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Organization admin access required" },
        { status },
      );
      logRequestMeta("/api/org/sessions/terminate", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json().catch(() => ({}));
    const scope = (body?.scope || "user") as TerminateScope;
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";

    let result: { rowCount?: number | null } = { rowCount: 0 };
    if (scope === "organization") {
      result = await query(
        "DELETE FROM physician_sessions WHERE organization_id = $1",
        [session.organizationId],
      );
    } else if (scope === "user" && isUuid(userId)) {
      result = await query(
        "DELETE FROM physician_sessions WHERE organization_id = $1 AND user_id = $2",
        [session.organizationId, userId],
      );
    } else {
      status = 400;
      const res = NextResponse.json(
        { error: "Valid scope and target userId are required" },
        { status },
      );
      logRequestMeta("/api/org/sessions/terminate", requestId, status, Date.now() - started);
      return res;
    }

    const terminatedSessions = typeof result.rowCount === "number" ? result.rowCount : 0;
    const res = NextResponse.json({ success: true, scope, terminatedSessions });
    logRequestMeta("/api/org/sessions/terminate", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[org/sessions/terminate] Error:", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/sessions/terminate", requestId, status, Date.now() - started);
    return res;
  }
}
