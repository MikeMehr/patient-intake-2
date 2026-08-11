/**
 * POST /api/cron/oscar-directory-reconcile — apply matches discovered by reading OSCAR's live
 * specialist roster and comparing it to bc_specialist_directory (matching logic lives in
 * src/lib/oscar/specialist-reconcile.ts, the actual OSCAR read is browser-driven — see that
 * module's header for why this can't run server-side).
 *
 * Gated by the same x-cron-secret convention as the other /api/cron/* routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { applyOscarReconciliationMatches, type ReconciliationMatchInput } from "@/lib/pathways-directory";

export const runtime = "nodejs";

const HEADER_NAME = "x-cron-secret";

function isValidMatch(m: unknown): m is ReconciliationMatchInput {
  const r = m as ReconciliationMatchInput;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.bcSpecialistId === "string" &&
    typeof r.oscarSpecId === "string" &&
    typeof r.oscarServiceName === "string"
  );
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get(HEADER_NAME);
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let organizationId: unknown;
  let matches: unknown;
  try {
    const body = await request.json();
    organizationId = body?.organizationId;
    matches = body?.matches;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof organizationId !== "string" || !organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }
  if (!Array.isArray(matches) || !matches.every(isValidMatch)) {
    return NextResponse.json({ error: "body.matches must be an array of reconciliation matches" }, { status: 400 });
  }

  try {
    const result = await applyOscarReconciliationMatches(organizationId, matches);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron/oscar-directory-reconcile] failed:", err);
    return NextResponse.json({ error: "Failed to apply reconciliation matches" }, { status: 502 });
  }
}
