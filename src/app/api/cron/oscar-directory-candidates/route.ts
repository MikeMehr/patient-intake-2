/**
 * GET /api/cron/oscar-directory-candidates — the {id, name, specialization} of every active
 * bc_specialist_directory row, for the reconciliation job to match against a live OSCAR roster
 * read. Reads from prod directly (rather than assuming a local mirror is still fresh) since only
 * the monthly job keeps prod's copy current; a local DB can drift.
 *
 * Gated by the same x-cron-secret convention as the other /api/cron/* routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getReconciliationCandidates } from "@/lib/pathways-directory";

export const runtime = "nodejs";

const HEADER_NAME = "x-cron-secret";

export async function GET(request: NextRequest) {
  const secret = request.headers.get(HEADER_NAME);
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const candidates = await getReconciliationCandidates();
  return NextResponse.json({ candidates });
}
