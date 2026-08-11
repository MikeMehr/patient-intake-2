/**
 * POST /api/physician/specialist-directory/queue — mark a PathwaysBC specialist as wanted in
 * this org's OSCAR. Does not touch OSCAR itself; see queueBcSpecialistForOscar.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { queueBcSpecialistForOscar } from "@/lib/pathways-directory";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const path = "/api/physician/specialist-directory/queue";

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "provider") {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized - Provider access required" }, { status });
      logRequestMeta(path, requestId, status, Date.now() - started);
      return res;
    }

    if (!session.organizationId) {
      status = 400;
      const res = NextResponse.json(
        { error: "Your account isn't part of a clinic organization, so there's no OSCAR to queue this into." },
        { status },
      );
      logRequestMeta(path, requestId, status, Date.now() - started);
      return res;
    }

    const body = (await request.json().catch(() => ({}))) as { bcSpecialistId?: string };
    const bcSpecialistId = String(body?.bcSpecialistId || "").trim();
    if (!bcSpecialistId) {
      status = 400;
      const res = NextResponse.json({ error: "bcSpecialistId is required." }, { status });
      logRequestMeta(path, requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(session);
    const providerNoResult = await query<{ oscar_provider_no: string | null }>(
      `SELECT oscar_provider_no FROM physicians WHERE id = $1`,
      [physicianId],
    );
    const requestedByProviderNo = providerNoResult.rows[0]?.oscar_provider_no ?? null;

    const result = await queueBcSpecialistForOscar(session.organizationId, bcSpecialistId, requestedByProviderNo);

    if (result.outcome === "NOT_FOUND") {
      status = 404;
      const res = NextResponse.json({ error: "That specialist wasn't found in the directory." }, { status });
      logRequestMeta(path, requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({ result });
    logRequestMeta(path, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[physician/specialist-directory/queue] POST failed:", error);
    const res = NextResponse.json({ error: "Failed to queue this specialist." }, { status });
    logRequestMeta(path, requestId, status, Date.now() - started);
    return res;
  }
}
