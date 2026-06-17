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
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/oscar-sync-summary", requestId, status, Date.now() - started);
      return res;
    }

    const row = (
      await query<{ failed: string; skipped: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE a.oscar_sync_status = 'FAILED')  AS failed,
           COUNT(*) FILTER (WHERE a.oscar_sync_status = 'SKIPPED') AS skipped
         FROM appointments a
         JOIN appointment_slots s ON s.id = a.slot_id
         WHERE a.organization_id = $1
           AND a.cancelled_at IS NULL
           AND s.start_time >= CURRENT_DATE`,
        [session.organizationId],
      )
    ).rows[0];

    const failed = Number(row?.failed ?? 0);
    const skipped = Number(row?.skipped ?? 0);

    const res = NextResponse.json({ failed, skipped, total: failed + skipped });
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
