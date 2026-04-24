/**
 * GET  /api/admin/email-templates  - List all global email templates (super admin only)
 * POST /api/admin/email-templates  - Create a new global email template (super admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "super_admin") {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Super admin access required" },
        { status }
      );
      logRequestMeta("/api/admin/email-templates", requestId, status, Date.now() - started);
      return res;
    }

    const result = await query<{
      id: string;
      name: string;
      subject: string;
      body: string;
      sort_order: number;
      created_at: string;
    }>(
      `SELECT id, name, subject, body, sort_order, created_at
       FROM email_templates
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, name ASC`
    );

    const res = NextResponse.json({ templates: result.rows }, { status });
    logRequestMeta("/api/admin/email-templates", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/admin/email-templates GET] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/admin/email-templates", requestId, status, Date.now() - started);
    return res;
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 201;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "super_admin") {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Super admin access required" },
        { status }
      );
      logRequestMeta("/api/admin/email-templates", requestId, status, Date.now() - started);
      return res;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
      logRequestMeta("/api/admin/email-templates", requestId, status, Date.now() - started);
      return res;
    }

    const { name, subject, body: templateBody } = (body || {}) as {
      name?: string;
      subject?: string;
      body?: string;
    };

    if (!name || typeof name !== "string" || !name.trim()) {
      status = 400;
      const res = NextResponse.json({ error: "Template name is required." }, { status });
      logRequestMeta("/api/admin/email-templates", requestId, status, Date.now() - started);
      return res;
    }

    const result = await query<{
      id: string;
      name: string;
      subject: string;
      body: string;
      created_at: string;
    }>(
      `INSERT INTO email_templates (name, subject, body)
       VALUES ($1, $2, $3)
       RETURNING id, name, subject, body, created_at`,
      [name.trim(), (subject || "").trim(), (templateBody || "").trim()]
    );

    const res = NextResponse.json({ template: result.rows[0] }, { status });
    logRequestMeta("/api/admin/email-templates", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/admin/email-templates POST] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/admin/email-templates", requestId, status, Date.now() - started);
    return res;
  }
}
