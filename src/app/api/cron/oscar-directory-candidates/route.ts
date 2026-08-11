/**
 * GET /api/cron/oscar-directory-candidates — the {id, name, specialization} of every active
 * bc_specialist_directory row, for the reconciliation job to match against a live OSCAR roster
 * read. Reads from prod directly (rather than assuming a local mirror is still fresh) since only
 * the monthly job keeps prod's copy current; a local DB can drift.
 *
 * Also returns organizationIds connected to OSCAR — a dev/local database and prod are separate
 * Postgres instances with independently-generated UUIDs, so "the org id I used locally" is NOT
 * valid against prod (confirmed the hard way: a reconciliation POST with a local org id fails
 * FK constraint bc_specialist_oscar_link_organization_id_fkey). Callers should look this up here
 * rather than hardcoding an id copied from a different environment.
 *
 * Gated by the same x-cron-secret convention as the other /api/cron/* routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getReconciliationCandidates } from "@/lib/pathways-directory";
import { query } from "@/lib/db";

export const runtime = "nodejs";

const HEADER_NAME = "x-cron-secret";

export async function GET(request: NextRequest) {
  const secret = request.headers.get(HEADER_NAME);
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [candidates, orgs] = await Promise.all([
    getReconciliationCandidates(),
    query<{ organization_id: string }>(`SELECT organization_id FROM emr_connections WHERE vendor = 'OSCAR'`),
  ]);
  return NextResponse.json({ candidates, organizationIds: orgs.rows.map((r) => r.organization_id) });
}
