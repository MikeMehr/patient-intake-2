import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

/**
 * GET /api/auth/ping
 * Lightweight keep-alive endpoint used by the UI's activity tracker.
 *
 * IMPORTANT: This is the ONLY place we intentionally refresh the idle timeout,
 * via getCurrentSession({ refresh: true }).
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession({ refresh: true });
    if (!session) {
      status = 401;
      const res = NextResponse.json({ error: "Not authenticated" }, { status });
      logRequestMeta("/api/auth/ping", requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({ ok: true, userType: session.userType });
    logRequestMeta("/api/auth/ping", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[auth/ping] Error:", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/auth/ping", requestId, status, Date.now() - started);
    return res;
  }
}

