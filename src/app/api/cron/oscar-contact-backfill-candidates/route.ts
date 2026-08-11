/**
 * GET /api/cron/oscar-contact-backfill-candidates — queued specialists (any org) still missing a
 * bc_specialist_contact_cache row, i.e. can't be pushed into OSCAR yet (phone+address required).
 * Gated by the same x-cron-secret convention as the other /api/cron/* routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getContactBackfillCandidates } from "@/lib/pathways-directory";

export const runtime = "nodejs";

const HEADER_NAME = "x-cron-secret";

export async function GET(request: NextRequest) {
  const secret = request.headers.get(HEADER_NAME);
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const candidates = await getContactBackfillCandidates();
  return NextResponse.json({ candidates });
}
