/**
 * GET /api/physician/email/settings  - Get physician's default email body
 * PUT /api/physician/email/settings  - Upsert physician's default email body
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(session);

    const result = await query<{ default_body: string }>(
      `SELECT default_body FROM physician_email_settings WHERE physician_id = $1`,
      [physicianId]
    );

    const defaultBody = result.rows[0]?.default_body ?? "";

    const res = NextResponse.json({ defaultBody }, { status });
    logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/email/settings GET] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
    return res;
  }
}

export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
      return res;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
      logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
      return res;
    }

    const { defaultBody } = (body || {}) as { defaultBody?: string };

    const physicianId = getEffectivePhysicianId(session);

    await query(
      `INSERT INTO physician_email_settings (physician_id, default_body, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (physician_id)
       DO UPDATE SET default_body = $2, updated_at = NOW()`,
      [physicianId, (defaultBody || "").trim()]
    );

    const res = NextResponse.json({ success: true }, { status });
    logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/email/settings PUT] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/email/settings", requestId, status, Date.now() - started);
    return res;
  }
}
