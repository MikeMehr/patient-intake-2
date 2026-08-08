/**
 * GET /api/org/oscar-sync-summary — Dashboard-level count of online bookings
 * that did NOT reach OSCAR's schedule, for the logged-in org admin's own org.
 *
 * Scopes to upcoming (today onward), non-cancelled appointments whose
 * oscar_sync_status is FAILED or SKIPPED — the actionable set staff may need to
 * enter manually. Returns only counts; no PHI.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getOrgAdminContext } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    const orgContext = await getOrgAdminContext(session);
    if (!orgContext) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/oscar-sync-summary", requestId, status, Date.now() - started);
      return res;
    }

    const row = (
      await query<{
        failed: string;
        skipped: string;
        pharmacy_failed: string;
        pharmacy_pending: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE a.oscar_sync_status = 'FAILED')  AS failed,
           COUNT(*) FILTER (WHERE a.oscar_sync_status = 'SKIPPED') AS skipped,
           COUNT(*) FILTER (WHERE a.pharmacy_link_status = 'FAILED')  AS pharmacy_failed,
           COUNT(*) FILTER (WHERE a.pharmacy_link_status = 'SKIPPED') AS pharmacy_pending
         FROM appointments a
         JOIN appointment_slots s ON s.id = a.slot_id
         WHERE a.organization_id = $1
           AND a.cancelled_at IS NULL
           AND s.start_time >= CURRENT_DATE`,
        [orgContext.organizationId],
      )
    ).rows[0];

    const failed = Number(row?.failed ?? 0);
    const skipped = Number(row?.skipped ?? 0);
    // Reported separately from the appointment sync: a pharmacy that needs adding by hand is a
    // different job from an appointment missing off the day sheet, and rolling them into one
    // total would make each look worse than it is.
    const pharmacyFailed = Number(row?.pharmacy_failed ?? 0);
    const pharmacyPending = Number(row?.pharmacy_pending ?? 0);

    const res = NextResponse.json({
      failed,
      skipped,
      total: failed + skipped,
      pharmacyFailed,
      pharmacyPending,
      pharmacyTotal: pharmacyFailed + pharmacyPending,
    });
    logRequestMeta("/api/org/oscar-sync-summary", requestId, status, Date.now() - started);
    return res;
  } catch (err) {
    status = 500;
    console.error("[/api/org/oscar-sync-summary] error:", err);
    const res = NextResponse.json({ error: "Internal error" }, { status });
    logRequestMeta("/api/org/oscar-sync-summary", requestId, status, Date.now() - started);
    return res;
  }
}
