/**
 * PUT    /api/physician/forms/[id] - Edit a form
 *   - If id is a form_templates UUID (inherited), creates a shadowing physician_forms row
 *   - If id is a physician_forms UUID, updates in-place
 * DELETE /api/physician/forms/[id] - Soft-delete a physician form
 *   - If id is an inherited template, creates a hidden shadow row to hide it
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

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Provider access required" },
        { status }
      );
      logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
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
      logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
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
      logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
      return res;
    }

    if (!questions || typeof questions !== "string" || !questions.trim()) {
      status = 400;
      const res = NextResponse.json({ error: "Form questions are required." }, { status });
      logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
      return res;
    }

    // Check if this id belongs to a physician_forms row for this physician
    const ownRow = await query<{ id: string; is_favourite: boolean }>(
      `SELECT id, is_favourite FROM physician_forms
       WHERE id = $1 AND physician_id = $2 AND deleted_at IS NULL`,
      [id, physicianId]
    );

    if (ownRow.rows.length > 0) {
      // Update the physician's own row in-place
      const result = await query<{ id: string; name: string; questions: string; category: string | null; is_favourite: boolean; source_template_id: string | null }>(
        `UPDATE physician_forms
         SET name = $1, questions = $2, category = $3, updated_at = NOW()
         WHERE id = $4 AND physician_id = $5
         RETURNING id, name, questions, category, is_favourite, source_template_id`,
        [name.trim(), questions.trim(), category?.trim() || null, id, physicianId]
      );
      const row = result.rows[0];
      const res = NextResponse.json({
        form: {
          id: row.id,
          name: row.name,
          questions: row.questions,
          category: row.category,
          isInherited: row.source_template_id !== null,
          isEdited: row.source_template_id !== null,
          isFavourite: row.is_favourite,
          sourceTemplateId: row.source_template_id,
        },
      }, { status });
      logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
      return res;
    }

    // Check if this id is a form_templates row (inherited)
    const templateRow = await query<{ id: string; is_favourite: boolean }>(
      `SELECT ft.id,
              COALESCE(pf.is_favourite, FALSE) AS is_favourite
       FROM form_templates ft
       LEFT JOIN physician_forms pf
         ON pf.source_template_id = ft.id AND pf.physician_id = $2
       WHERE ft.id = $1 AND ft.deleted_at IS NULL`,
      [id, physicianId]
    );

    if (templateRow.rows.length > 0) {
      // Delete any existing shadow row first (e.g. favourite-only row with no content change)
      await query(
        `DELETE FROM physician_forms
         WHERE source_template_id = $1 AND physician_id = $2`,
        [id, physicianId]
      );
      // Create a new shadowing row with edited content
      const result = await query<{ id: string; name: string; questions: string; category: string | null; is_favourite: boolean; source_template_id: string | null }>(
        `INSERT INTO physician_forms (physician_id, name, questions, category, source_template_id, is_favourite)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, questions, category, is_favourite, source_template_id`,
        [
          physicianId,
          name.trim(),
          questions.trim(),
          category?.trim() || null,
          id,
          templateRow.rows[0].is_favourite,
        ]
      );
      const row = result.rows[0];
      const res = NextResponse.json({
        form: {
          id: row.id,
          name: row.name,
          questions: row.questions,
          category: row.category,
          isInherited: true,
          isEdited: true,
          isFavourite: row.is_favourite,
          sourceTemplateId: row.source_template_id,
        },
      }, { status });
      logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
      return res;
    }

    status = 404;
    const res = NextResponse.json({ error: "Form not found." }, { status });
    logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/forms/[id] PUT] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
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

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Provider access required" },
        { status }
      );
      logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;
    const physicianId = getEffectivePhysicianId(session);

    // Check if this is the physician's own row
    const ownRow = await query<{ id: string }>(
      `SELECT id FROM physician_forms
       WHERE id = $1 AND physician_id = $2 AND deleted_at IS NULL`,
      [id, physicianId]
    );

    if (ownRow.rows.length > 0) {
      await query(
        `UPDATE physician_forms SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND physician_id = $2`,
        [id, physicianId]
      );
      const res = NextResponse.json({ success: true }, { status });
      logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
      return res;
    }

    // Check if this is an inherited template — create a hidden shadow row
    const templateRow = await query<{ id: string; name: string; questions: string; category: string | null }>(
      `SELECT id, name, questions, category
       FROM form_templates
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (templateRow.rows.length > 0) {
      const t = templateRow.rows[0];
      // Remove any existing non-deleted shadow row first, then insert a deleted shadow
      await query(
        `DELETE FROM physician_forms
         WHERE source_template_id = $1 AND physician_id = $2 AND deleted_at IS NULL`,
        [id, physicianId]
      );
      await query(
        `INSERT INTO physician_forms (physician_id, name, questions, category, source_template_id, deleted_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [physicianId, t.name, t.questions, t.category, id]
      );
      const res = NextResponse.json({ success: true }, { status });
      logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
      return res;
    }

    status = 404;
    const res = NextResponse.json({ error: "Form not found." }, { status });
    logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/forms/[id] DELETE] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/forms/[id]", requestId, status, Date.now() - started);
    return res;
  }
}
