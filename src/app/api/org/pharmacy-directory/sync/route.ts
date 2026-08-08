/**
 * Pharmacy directory sync for the caller's own organization.
 *
 * GET  — current state (how many pharmacies, when it last synced, last error).
 * POST — pull the directory from OSCAR through the pharmacy bridge and mirror it locally.
 *
 * The mirror is what the patient-facing typeahead searches, so it has to exist before the picker
 * is useful. It is also refreshed weekly by /api/cron/pharmacy-directory-sync and lazily by the
 * search route, making this the manual override rather than the only path.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getOrgAdminContext } from "@/lib/auth-helpers";
import { getPharmacyDirectoryState, syncPharmacyDirectoryForOrg } from "@/lib/pharmacy-directory";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

const ROUTE = "/api/org/pharmacy-directory/sync";

async function requireBookingAccess() {
  return getOrgAdminContext(await getCurrentSession());
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();

  try {
    const orgContext = await requireBookingAccess();
    if (!orgContext) {
      logRequestMeta(ROUTE, requestId, 401, Date.now() - started);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const state = await getPharmacyDirectoryState(orgContext.organizationId);
    logRequestMeta(ROUTE, requestId, 200, Date.now() - started);
    return NextResponse.json({
      count: state.count,
      lastSuccessAt: state.lastSuccessAt,
      lastAttemptAt: state.lastAttemptAt,
      lastStatus: state.lastStatus,
      lastError: state.lastError,
    });
  } catch (err) {
    console.error(`[${ROUTE}] error:`, err);
    logRequestMeta(ROUTE, requestId, 500, Date.now() - started);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();

  try {
    const orgContext = await requireBookingAccess();
    if (!orgContext) {
      logRequestMeta(ROUTE, requestId, 401, Date.now() - started);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await syncPharmacyDirectoryForOrg(orgContext.organizationId);
    if ("error" in result) {
      logRequestMeta(ROUTE, requestId, result.status, Date.now() - started);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const state = await getPharmacyDirectoryState(orgContext.organizationId);
    logRequestMeta(ROUTE, requestId, 200, Date.now() - started);
    return NextResponse.json({
      synced: result.synced,
      deactivated: result.deactivated,
      count: state.count,
      lastSuccessAt: state.lastSuccessAt,
    });
  } catch (err) {
    console.error(`[${ROUTE}] error:`, err);
    logRequestMeta(ROUTE, requestId, 500, Date.now() - started);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
