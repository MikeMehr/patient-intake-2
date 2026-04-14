/**
 * PATCH /api/physician/forms/[id]/favourite
 * Toggle the favourite flag on a physician's form.
 * If the id refers to an inherited template (no physician_forms row yet),
 * a lightweight shadow row is created with is_favourite=true.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Provider access required" },
        { status }
      );
      logRequestMeta("/api/physician/forms/[id]/favourite", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;
    const physicianId = getEffectivePhysicianId(session);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
      logRequestMeta("/api/physician/forms/[id]/favourite", requestId, status, Date.now() - started);
      return res;
    }

    const { isFavourite } = (body || {}) as { isFavourite?: boolean };
    if (typeof isFavourite !== "boolean") {
      status = 400;
      const res = NextResponse.json({ error: "isFavourite (boolean) is required." }, { status });
      logRequestMeta("/api/physician/forms/[id]/favourite", requestId, status, Date.now() - started);
      return res;
    }

    // Check if this is the physician's own row (own form or existing shadow)
    const ownRow = await query<{ id: string }>(
      `SELECT id FROM physician_forms
       WHERE id = $1 AND physician_id = $2 AND deleted_at IS NULL`,
      [id, physicianId]
    );

    if (ownRow.rows.length > 0) {
      await query(
        `UPDATE physician_forms SET is_favourite = $1, updated_at = NOW()
         WHERE id = $2 AND physician_id = $3`,
        [isFavourite, id, physicianId]
      );
      const res = NextResponse.json({ success: true, isFavourite }, { status });
      logRequestMeta("/api/physician/forms/[id]/favourite", requestId, status, Date.now() - started);
      return res;
    }

    // Inherited template — need to create a shadow row to store the favourite flag
    const templateRow = await query<{ id: string; name: string; questions: string; category: string | null }>(
      `SELECT id, name, questions, category
       FROM form_templates
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (templateRow.rows.length > 0) {
      const t = templateRow.rows[0];
      if (isFavourite) {
        // Create a shadow row that only marks favourite (content mirrors the template)
        await query(
          `INSERT INTO physician_forms
             (physician_id, name, questions, category, source_template_id, is_favourite)
           VALUES ($1, $2, $3, $4, $5, TRUE)
           ON CONFLICT DO NOTHING`,
          [physicianId, t.name, t.questions, t.category, id]
        );
      }
      // If isFavourite=false and there was no shadow row, nothing to do.
      const res = NextResponse.json({ success: true, isFavourite }, { status });
      logRequestMeta("/api/physician/forms/[id]/favourite", requestId, status, Date.now() - started);
      return res;
    }

    status = 404;
    const res = NextResponse.json({ error: "Form not found." }, { status });
    logRequestMeta("/api/physician/forms/[id]/favourite", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/forms/[id]/favourite PATCH] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/forms/[id]/favourite", requestId, status, Date.now() - started);
    return res;
  }
}
