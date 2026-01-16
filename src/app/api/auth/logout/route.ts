/**
 * POST /api/auth/logout
 * Physician logout endpoint
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteSession } from "@/lib/auth";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("physician_session")?.value;

    if (token) {
      await deleteSession(token);
    }

    const res = NextResponse.json({ success: true });
    logRequestMeta("/api/auth/logout", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[auth/logout] Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/auth/logout", requestId, status, Date.now() - started);
    return res;
  }
}

