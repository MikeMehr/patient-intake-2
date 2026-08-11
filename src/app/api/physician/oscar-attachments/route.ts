/**
 * GET /api/physician/oscar-attachments?demographicNo=123&openerOrigin=https://oscar.example
 *
 * Files patients attached when booking, for one OSCAR chart, that have not yet
 * been filed into that chart. Backs the popup the eChart "Chart Attachment"
 * button opens.
 *
 * Like the transcription resolve route, the response carries
 * `allowedOpenerOrigin` — the ONLY way the browser learns which origin it may
 * post the file bytes back to. The URL parameter is advisory; the server-side
 * allow-list is authoritative.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { resolveAllowedOpenerOrigin } from "@/lib/oscar/launch-origins";

export const runtime = "nodejs";

const ROUTE = "/api/physician/oscar-attachments";
const DEMOGRAPHIC_NO_RE = /^[0-9]{1,12}$/;

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();

  try {
    const session = await getCurrentSession();
    if (!session) {
      logRequestMeta(ROUTE, requestId, 401, Date.now() - started);
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    if (session.userType !== "provider") {
      logRequestMeta(ROUTE, requestId, 403, Date.now() - started);
      return NextResponse.json({ error: "Provider access required." }, { status: 403 });
    }
    const organizationId = session.organizationId;
    if (!organizationId) {
      logRequestMeta(ROUTE, requestId, 403, Date.now() - started);
      return NextResponse.json({ error: "Provider access required." }, { status: 403 });
    }

    const sp = request.nextUrl.searchParams;
    const demographicNo = (sp.get("demographicNo") ?? "").trim();
    const allowedOpenerOrigin = resolveAllowedOpenerOrigin(sp.get("openerOrigin"));

    if (!DEMOGRAPHIC_NO_RE.test(demographicNo)) {
      logRequestMeta(ROUTE, requestId, 400, Date.now() - started);
      return NextResponse.json(
        { error: "A valid demographicNo is required.", allowedOpenerOrigin },
        { status: 400 },
      );
    }

    // Scoped by organization AND by the OSCAR chart the patient booked against, so a
    // physician can only ever see files belonging to their own clinic's bookings.
    const result = await query<{
      id: string;
      original_filename: string | null;
      content_type: string | null;
      size_bytes: string | null;
      uploaded_at: Date;
      reason: string | null;
      slot_start_time: Date | null;
    }>(
      `SELECT f.id, f.original_filename, f.content_type, f.size_bytes, f.uploaded_at,
              a.reason, s.start_time AS slot_start_time
       FROM appointment_files f
       JOIN appointments a ON a.id = f.appointment_id
       LEFT JOIN appointment_slots s ON s.id = a.slot_id
       WHERE a.organization_id = $1
         AND a.oscar_demographic_no = $2
         AND f.imported_to_oscar_at IS NULL
       ORDER BY f.uploaded_at`,
      [organizationId, demographicNo],
    );

    const toIso = (d: Date | null) =>
      d ? (d instanceof Date ? d.toISOString() : String(d)) : null;

    logRequestMeta(ROUTE, requestId, 200, Date.now() - started);
    return NextResponse.json({
      allowedOpenerOrigin,
      files: result.rows.map((r) => ({
        id: r.id,
        filename: r.original_filename,
        contentType: r.content_type,
        sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
        uploadedAt: toIso(r.uploaded_at),
        reason: r.reason,
        appointmentAt: toIso(r.slot_start_time),
      })),
    });
  } catch (error) {
    console.error("[api/physician/oscar-attachments] Error:", error);
    logRequestMeta(ROUTE, requestId, 500, Date.now() - started);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
