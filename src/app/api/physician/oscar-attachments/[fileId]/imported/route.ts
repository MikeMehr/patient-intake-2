/**
 * POST /api/physician/oscar-attachments/[fileId]/imported
 *
 * Records that this attachment has been filed into the patient's OSCAR chart, so
 * it stops being offered for import. Called only after the OSCAR page acknowledges
 * that its own upload succeeded.
 *
 * Idempotent: a second call leaves the original timestamp alone, so a double-click
 * can't rewrite history. Tries both source tables (booking attachment, document-
 * request upload) — the id only ever matches a row in one of them.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";

export const runtime = "nodejs";

const ROUTE = "/api/physician/oscar-attachments/[fileId]/imported";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  const { fileId } = await params;

  try {
    const session = await getCurrentSession();
    if (!session) {
      logRequestMeta(ROUTE, requestId, 401, Date.now() - started);
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    if (session.userType !== "provider" || !session.organizationId) {
      logRequestMeta(ROUTE, requestId, 403, Date.now() - started);
      return NextResponse.json({ error: "Provider access required." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { oscarDocumentNo?: unknown };
    const oscarDocumentNo =
      typeof body.oscarDocumentNo === "string" && /^\d{1,12}$/.test(body.oscarDocumentNo)
        ? body.oscarDocumentNo
        : null;

    let result = await query<{ id: string; oscar_demographic_no: string | null }>(
      `UPDATE appointment_files f
       SET imported_to_oscar_at = COALESCE(f.imported_to_oscar_at, NOW())
       FROM appointments a
       WHERE f.appointment_id = a.id
         AND f.id = $1
         AND a.organization_id = $2
       RETURNING f.id, a.oscar_demographic_no`,
      [fileId, session.organizationId],
    );

    if (!result.rows.length) {
      result = await query<{ id: string; oscar_demographic_no: string | null }>(
        `UPDATE patient_document_files f
         SET imported_to_oscar_at = COALESCE(f.imported_to_oscar_at, NOW())
         FROM patient_document_requests r
         WHERE f.request_id = r.id
           AND f.id = $1
           AND r.organization_id = $2
         RETURNING f.id, r.oscar_demographic_no`,
        [fileId, session.organizationId],
      );
    }

    if (!result.rows.length) {
      logRequestMeta(ROUTE, requestId, 404, Date.now() - started);
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    await logPhysicianPhiAudit({
      physicianId: getEffectivePhysicianId(session),
      eventType: "oscar_attachment_filed_to_chart",
      ipAddress: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        fileId,
        demographicNo: result.rows[0].oscar_demographic_no,
        oscarDocumentNo,
      },
    }).catch(() => {});

    logRequestMeta(ROUTE, requestId, 200, Date.now() - started);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[${ROUTE}] Error:`, error);
    logRequestMeta(ROUTE, requestId, 500, Date.now() - started);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
