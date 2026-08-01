/**
 * POST /api/cron/pharmacy-directory-sync — refresh every connected clinic's pharmacy directory.
 *
 * Weekly is plenty; BC's community pharmacy list barely moves. Gated by the same x-cron-secret
 * shared secret as /api/invitations/cleanup — this path is not behind a session, so the header is
 * the only gate.
 *
 * One clinic's failure does not stop the others: each org is reported separately and the route
 * still returns 200, because a partially-successful sweep is a normal outcome, not an error.
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { syncPharmacyDirectoryForOrg } from "@/lib/pharmacy-directory";

export const runtime = "nodejs";

const HEADER_NAME = "x-cron-secret";

export async function POST(request: NextRequest) {
  const secret = request.headers.get(HEADER_NAME);
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const orgs = await query<{ organization_id: string }>(
      `SELECT organization_id FROM emr_connections WHERE vendor = 'OSCAR'`,
    );

    const results: Array<{ organizationId: string; synced?: number; error?: string }> = [];
    for (const { organization_id: orgId } of orgs.rows) {
      const result = await syncPharmacyDirectoryForOrg(orgId);
      results.push(
        "error" in result
          ? { organizationId: orgId, error: result.error }
          : { organizationId: orgId, synced: result.synced },
      );
    }

    const failed = results.filter((r) => r.error).length;
    if (failed > 0) {
      console.error(
        `[cron/pharmacy-directory-sync] ${failed}/${results.length} organizations failed to sync`,
      );
    }
    return NextResponse.json({ organizations: results.length, failed, results });
  } catch (err) {
    console.error("[cron/pharmacy-directory-sync] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
