/**
 * GET  /api/physician/forms  - List merged forms (inherited templates + physician's own)
 * POST /api/physician/forms  - Create a new physician-owned form
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export interface PhysicianFormItem {
  id: string;
  name: string;
  questions: string;
  category: string | null;
  isInherited: boolean;
  isEdited: boolean;
  isFavourite: boolean;
  sourceTemplateId: string | null;
}

export async function GET(request: NextRequest) {
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
      logRequestMeta("/api/physician/forms", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(session);

    // Merged query:
    // 1. Inherited templates whose id is NOT shadowed by a physician_forms row for this physician
    // 2. UNION physician_forms rows for this physician (non-deleted) — these include:
    //    - physician's own forms (source_template_id IS NULL)
    //    - edits/favourites of inherited templates (source_template_id IS NOT NULL, deleted_at IS NULL)
    const result = await query<{
      id: string;
      name: string;
      questions: string;
      category: string | null;
      is_inherited: boolean;
      is_edited: boolean;
      is_favourite: boolean;
      source_template_id: string | null;
      sort_order: number;
    }>(
      `-- Inherited templates not shadowed by this physician
       SELECT
         ft.id,
         ft.name,
         ft.questions,
         ft.category,
         TRUE   AS is_inherited,
         FALSE  AS is_edited,
         FALSE  AS is_favourite,
         NULL::uuid AS source_template_id,
         ft.sort_order
       FROM form_templates ft
       WHERE ft.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM physician_forms pf
           WHERE pf.physician_id = $1
             AND pf.source_template_id = ft.id
         )

       UNION ALL

       -- Physician's own rows (edits, favourites, own forms — excluding hidden ones)
       SELECT
         pf.id,
         pf.name,
         pf.questions,
         pf.category,
         (pf.source_template_id IS NOT NULL) AS is_inherited,
         (pf.source_template_id IS NOT NULL) AS is_edited,
         pf.is_favourite,
         pf.source_template_id,
         pf.sort_order
       FROM physician_forms pf
       WHERE pf.physician_id = $1
         AND pf.deleted_at IS NULL

       ORDER BY category NULLS LAST, sort_order ASC, name ASC`,
      [physicianId]
    );

    const forms: PhysicianFormItem[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      questions: row.questions,
      category: row.category,
      isInherited: row.is_inherited,
      isEdited: row.is_edited,
      isFavourite: row.is_favourite,
      sourceTemplateId: row.source_template_id,
    }));

    const res = NextResponse.json({ forms }, { status });
    logRequestMeta("/api/physician/forms", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/forms GET] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/forms", requestId, status, Date.now() - started);
    return res;
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 201;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Provider access required" },
        { status }
      );
      logRequestMeta("/api/physician/forms", requestId, status, Date.now() - started);
      return res;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
      logRequestMeta("/api/physician/forms", requestId, status, Date.now() - started);
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
      logRequestMeta("/api/physician/forms", requestId, status, Date.now() - started);
      return res;
    }

    if (!questions || typeof questions !== "string" || !questions.trim()) {
      status = 400;
      const res = NextResponse.json({ error: "Form questions are required." }, { status });
      logRequestMeta("/api/physician/forms", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(session);

    const result = await query<{
      id: string;
      name: string;
      questions: string;
      category: string | null;
      created_at: string;
    }>(
      `INSERT INTO physician_forms (physician_id, name, questions, category)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, questions, category, created_at`,
      [physicianId, name.trim(), questions.trim(), category?.trim() || null]
    );

    const form: PhysicianFormItem = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      questions: result.rows[0].questions,
      category: result.rows[0].category,
      isInherited: false,
      isEdited: false,
      isFavourite: false,
      sourceTemplateId: null,
    };

    const res = NextResponse.json({ form }, { status });
    logRequestMeta("/api/physician/forms", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/forms POST] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/forms", requestId, status, Date.now() - started);
    return res;
  }
}
