/**
 * GET /api/oscar-sync/candidates?t=TOKEN — queued specialists this org still needs written into
 * OSCAR, for the self-service bookmarklet (see src/lib/oscar-sync-bookmarklet.ts).
 *
 * Split into `ready` (has the phone+address OSCAR demands) and `needsContact` (doesn't yet), so
 * the bookmarklet can tell the physician exactly why something wasn't synced instead of silently
 * skipping it.
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getQueuedOscarSyncCandidates } from "@/lib/pathways-directory";
import { candidateHasRequiredContactInfo } from "@/lib/oscar/specialist-sync-plan";
import { corsHeaders, handleOptions, isAuthorized, unauthorized } from "@/lib/oscar-sync-bookmarklet";

export const runtime = "nodejs";

export async function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized(request);

  const orgs = await query<{ organization_id: string }>(
    `SELECT organization_id FROM emr_connections WHERE vendor = 'OSCAR'`,
  );

  const ready = [];
  const needsContact = [];
  for (const { organization_id: orgId } of orgs.rows) {
    for (const candidate of await getQueuedOscarSyncCandidates(orgId)) {
      const entry = { ...candidate, organizationId: orgId };
      if (candidateHasRequiredContactInfo(candidate)) ready.push(entry);
      else needsContact.push(entry);
    }
  }

  return NextResponse.json({ ready, needsContact }, { headers: corsHeaders(request) });
}
