/**
 * GET  /api/physician/email/templates  - List merged templates (global + physician's own)
 * POST /api/physician/email/templates  - Create a new physician-owned email template
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export interface EmailTemplateItem {
  id: string;
  name: string;
  subject: string;
  body: string;
  isGlobal: boolean;
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
      const res = NextResponse.json({ error: "Unauthorized - Provider access required" }, { status });
      logRequestMeta("/api/physician/email/templates", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(session);

    // Global templates not shadowed by a physician-owned copy, UNION physician's own templates
    const result = await query<{
      id: string;
      name: string;
      subject: string;
      body: string;
      is_global: boolean;
      source_template_id: string | null;
      sort_order: number;
    }>(
      `SELECT
         et.id,
         et.name,
         et.subject,
         et.body,
         TRUE AS is_global,
         NULL::uuid AS source_template_id,
         et.sort_order
       FROM email_templates et
       WHERE et.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM physician_email_templates pet
           WHERE pet.physician_id = $1
             AND pet.source_template_id = et.id
             AND pet.deleted_at IS NULL
         )

       UNION ALL

       SELECT
         pet.id,
         pet.name,
         pet.subject,
         pet.body,
         FALSE AS is_global,
         pet.source_template_id,
         pet.sort_order
       FROM physician_email_templates pet
       WHERE pet.physician_id = $1
         AND pet.deleted_at IS NULL

       ORDER BY is_global ASC, sort_order ASC, name ASC`,
      [physicianId]
    );

    const templates: EmailTemplateItem[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      subject: row.subject,
      body: row.body,
      isGlobal: row.is_global,
      sourceTemplateId: row.source_template_id,
    }));

    const res = NextResponse.json({ templates }, { status });
    logRequestMeta("/api/physician/email/templates", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/email/templates GET] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/email/templates", requestId, status, Date.now() - started);
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
      const res = NextResponse.json({ error: "Unauthorized - Provider access required" }, { status });
      logRequestMeta("/api/physician/email/templates", requestId, status, Date.now() - started);
      return res;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      status = 400;
      const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
      logRequestMeta("/api/physician/email/templates", requestId, status, Date.now() - started);
      return res;
    }

    const { name, subject, body: templateBody, sourceTemplateId } = (body || {}) as {
      name?: string;
      subject?: string;
      body?: string;
      sourceTemplateId?: string;
    };

    if (!name || typeof name !== "string" || !name.trim()) {
      status = 400;
      const res = NextResponse.json({ error: "Template name is required." }, { status });
      logRequestMeta("/api/physician/email/templates", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(session);

    const result = await query<{
      id: string;
      name: string;
      subject: string;
      body: string;
      source_template_id: string | null;
    }>(
      `INSERT INTO physician_email_templates (physician_id, name, subject, body, source_template_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, subject, body, source_template_id`,
      [
        physicianId,
        name.trim(),
        (subject || "").trim(),
        (templateBody || "").trim(),
        sourceTemplateId || null,
      ]
    );

    const template: EmailTemplateItem = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      subject: result.rows[0].subject,
      body: result.rows[0].body,
      isGlobal: false,
      sourceTemplateId: result.rows[0].source_template_id,
    };

    const res = NextResponse.json({ template }, { status });
    logRequestMeta("/api/physician/email/templates", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[api/physician/email/templates POST] Error:", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/physician/email/templates", requestId, status, Date.now() - started);
    return res;
  }
}
