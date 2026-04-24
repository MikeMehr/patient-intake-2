/**
 * DELETE /api/admin/email-templates/[id]  - Soft-delete a global email template (super admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

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
    if (!session || session.userType !== "super_admin") {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Super admin access required" },
        { status }
      );
      logRequestMeta(`/api/admin/email-templates/${id}`, requestId, status, Date.now() - started);
      return res;
    }

    const result = await query<{ id: string }>(
      `UPDATE email_templates
       SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [id]
    );

    if (!result.rows.length) {
      status = 404;
      const res = NextResponse.json({ error: "Template not found." }, { status });
      logRequestMeta(`/api/admin/email-templates/${id}`, requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({ success: true }, { status });
    logRequestMeta(`/api/admin/email-templates/${id}`, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error(`[api/admin/email-templates/${id} DELETE] Error:`, error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta(`/api/admin/email-templates/${id}`, requestId, status, Date.now() - started);
    return res;
  }
}
