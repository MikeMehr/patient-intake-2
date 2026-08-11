/**
 * GET /api/physician/specialist-directory — search the local PathwaysBC mirror.
 *
 * Query params: specialty, city, q (name search), sort ("wait" | "name"), limit.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { searchBcSpecialistDirectory } from "@/lib/pathways-directory";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const path = "/api/physician/specialist-directory";

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized - Provider access required" }, { status });
      logRequestMeta(path, requestId, status, Date.now() - started);
      return res;
    }

    const sp = request.nextUrl.searchParams;
    const sort = sp.get("sort") === "name" ? "name" : "wait";
    const limitParam = Number(sp.get("limit"));

    const specialists = await searchBcSpecialistDirectory({
      organizationId: session.organizationId || null,
      specialty: sp.get("specialty") || undefined,
      city: sp.get("city") || undefined,
      q: sp.get("q") || undefined,
      sort,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
    });

    const res = NextResponse.json({ specialists });
    logRequestMeta(path, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/specialist-directory] GET failed:", error);
    const res = NextResponse.json({ error: "Failed to search the specialist directory." }, { status });
    logRequestMeta(path, requestId, status, Date.now() - started);
    return res;
  }
}
