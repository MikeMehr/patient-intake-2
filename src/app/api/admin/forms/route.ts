/**
 * GET  /api/admin/forms  - List all form templates (super admin only)
 * POST /api/admin/forms  - Create a new form template (super admin only)
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
      logRequestMeta("/api/admin/forms", requestId, status, Date.now() - started);
      return res;
    }

    const result = await query<{
      id: string;
      name: string;
      questions: string;
      category: string | null;
      sort_order: number;
      created_at: string;
    }>(
      `SELECT id, name, questions, category, sort_order, created_at
       FROM form_templates
       WHERE deleted_at IS NULL
       ORDER BY category NULLS LAST, sort_order ASC, name ASC`
    );

    const res = NextResponse.json({ templates: result.rows }, { status });
    logRequestMeta("/api/admin/forms", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/admin/forms GET] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/admin/forms", requestId, status, Date.now() - started);
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
      logRequestMeta("/api/admin/forms", requestId, status, Date.now() - started);
      return res;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
      logRequestMeta("/api/admin/forms", requestId, status, Date.now() - started);
      return res;
    }

    const { name, questions, category } = (body || {}) as {
      name?: string;
      questions?: string;
      category?: string;
    };

    if (!name || typeof name !== "string" || !name.trim()) {
      status = 400;
      const res = NextResponse.json({ error: "Form name is required." }, { status });
      logRequestMeta("/api/admin/forms", requestId, status, Date.now() - started);
      return res;
    }

    if (!questions || typeof questions !== "string" || !questions.trim()) {
      status = 400;
      const res = NextResponse.json({ error: "Form questions are required." }, { status });
      logRequestMeta("/api/admin/forms", requestId, status, Date.now() - started);
      return res;
    }

    const result = await query<{ id: string; name: string; questions: string; category: string | null; created_at: string }>(
      `INSERT INTO form_templates (name, questions, category)
       VALUES ($1, $2, $3)
       RETURNING id, name, questions, category, created_at`,
      [name.trim(), questions.trim(), category?.trim() || null]
    );

    const res = NextResponse.json({ template: result.rows[0] }, { status });
    logRequestMeta("/api/admin/forms", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/admin/forms POST] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/admin/forms", requestId, status, Date.now() - started);
    return res;
  }
}
