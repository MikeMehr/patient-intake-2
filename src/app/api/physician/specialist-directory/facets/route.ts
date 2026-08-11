/**
 * GET /api/physician/specialist-directory/facets — filter dropdown options + sync freshness.
 *
 * Separate from the search route because specialties/cities don't change per-keystroke; the
 * directory page fetches this once on mount rather than on every filter change.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getBcSpecialistDirectoryFacets, getBcSpecialistDirectoryState } from "@/lib/pathways-directory";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const path = "/api/physician/specialist-directory/facets";

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized - Provider access required" }, { status });
      logRequestMeta(path, requestId, status, Date.now() - started);
      return res;
    }

    const [facets, state] = await Promise.all([
      getBcSpecialistDirectoryFacets(),
      getBcSpecialistDirectoryState(),
    ]);

    const res = NextResponse.json({
      specialties: facets.specialties,
      cities: facets.cities,
      totalCount: state.count,
      lastSyncedAt: state.lastSuccessAt,
    });
    logRequestMeta(path, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/specialist-directory/facets] GET failed:", error);
    const res = NextResponse.json({ error: "Failed to load directory filters." }, { status });
    logRequestMeta(path, requestId, status, Date.now() - started);
    return res;
  }
}
