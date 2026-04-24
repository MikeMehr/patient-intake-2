/**
 * PUT    /api/physician/email/templates/[id]  - Update physician's own template
 * DELETE /api/physician/email/templates/[id]  - Soft-delete physician's own template
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const { id } = await params;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta(`/api/physician/email/templates/${id}`, requestId, status, Date.now() - started);
      return res;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
      logRequestMeta(`/api/physician/email/templates/${id}`, requestId, status, Date.now() - started);
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
      logRequestMeta(`/api/physician/email/templates/${id}`, requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(session);

    const result = await query<{ id: string }>(
      `UPDATE physician_email_templates
       SET name = $1, subject = $2, body = $3, updated_at = NOW()
       WHERE id = $4 AND physician_id = $5 AND deleted_at IS NULL
       RETURNING id`,
      [
        name.trim(),
        (subject || "").trim(),
        (templateBody || "").trim(),
        id,
        physicianId,
      ]
    );

    if (!result.rows.length) {
      status = 404;
      const res = NextResponse.json({ error: "Template not found." }, { status });
      logRequestMeta(`/api/physician/email/templates/${id}`, requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({ success: true }, { status });
    logRequestMeta(`/api/physician/email/templates/${id}`, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error(`[api/physician/email/templates/${id} PUT] Error:`, error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta(`/api/physician/email/templates/${id}`, requestId, status, Date.now() - started);
    return res;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const { id } = await params;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta(`/api/physician/email/templates/${id}`, requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(session);

    const result = await query<{ id: string }>(
      `UPDATE physician_email_templates
       SET deleted_at = NOW()
       WHERE id = $1 AND physician_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, physicianId]
    );

    if (!result.rows.length) {
      status = 404;
      const res = NextResponse.json({ error: "Template not found." }, { status });
      logRequestMeta(`/api/physician/email/templates/${id}`, requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({ success: true }, { status });
    logRequestMeta(`/api/physician/email/templates/${id}`, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error(`[api/physician/email/templates/${id} DELETE] Error:`, error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta(`/api/physician/email/templates/${id}`, requestId, status, Date.now() - started);
    return res;
  }
}
