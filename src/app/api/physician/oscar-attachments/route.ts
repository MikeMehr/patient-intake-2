/**
 * GET /api/physician/oscar-attachments?demographicNo=123&openerOrigin=https://oscar.example
 *
 * Files waiting to be filed into one OSCAR chart — from two sources: a patient
 * attaching a file when booking (appointment_files), and a patient uploading
 * through a "Request Documents" link the physician sent from that patient's
 * eChart (patient_document_files, linked via patient_document_requests.
 * oscar_demographic_no — only set when the request was started from the
 * eChart's "Request Docs" button). Backs the popup the eChart "Chart
 * Attachment" button opens.
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

    // Scoped by organization AND by the OSCAR chart, so a physician can only ever see
    // files belonging to their own clinic's patients. UNION ALL of the two source
    // tables — ids are UUIDs from separate tables so collision isn't a concern, and
    // each branch carries its own "source" so the fileId routes below know which
    // table to read/update.
    const result = await query<{
      id: string;
      source: "booking" | "document_request";
      original_filename: string | null;
      content_type: string | null;
      size_bytes: string | null;
      uploaded_at: Date;
      reason: string | null;
      appointment_at: Date | null;
    }>(
      `SELECT f.id, 'booking' AS source, f.original_filename, f.content_type, f.size_bytes,
              f.uploaded_at, a.reason, s.start_time AS appointment_at
       FROM appointment_files f
       JOIN appointments a ON a.id = f.appointment_id
       LEFT JOIN appointment_slots s ON s.id = a.slot_id
       WHERE a.organization_id = $1
         AND a.oscar_demographic_no = $2
         AND f.imported_to_oscar_at IS NULL

       UNION ALL

       SELECT f.id, 'document_request' AS source, f.original_filename, f.content_type, f.size_bytes,
              f.uploaded_at, r.request_note AS reason, NULL::timestamptz AS appointment_at
       FROM patient_document_files f
       JOIN patient_document_requests r ON r.id = f.request_id
       WHERE r.organization_id = $1
         AND r.oscar_demographic_no = $2
         AND f.imported_to_oscar_at IS NULL
         AND f.deleted_at IS NULL

       ORDER BY uploaded_at`,
      [organizationId, demographicNo],
    );

    const toIso = (d: Date | null) =>
      d ? (d instanceof Date ? d.toISOString() : String(d)) : null;

    logRequestMeta(ROUTE, requestId, 200, Date.now() - started);
    return NextResponse.json({
      allowedOpenerOrigin,
      files: result.rows.map((r) => ({
        id: r.id,
        source: r.source,
        filename: r.original_filename,
        contentType: r.content_type,
        sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
        uploadedAt: toIso(r.uploaded_at),
        reason: r.reason,
        appointmentAt: toIso(r.appointment_at),
      })),
    });
  } catch (error) {
    console.error("[api/physician/oscar-attachments] Error:", error);
    logRequestMeta(ROUTE, requestId, 500, Date.now() - started);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
