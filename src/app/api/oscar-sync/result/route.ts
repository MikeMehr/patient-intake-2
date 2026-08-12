/**
 * POST /api/oscar-sync/result?t=TOKEN — record what the bookmarklet actually managed to write
 * into OSCAR, per queued link. Reuses recordOscarSyncOutcome, the same bookkeeping the
 * (manual) sync path already used.
 */

import { NextRequest, NextResponse } from "next/server";
import { recordOscarSyncOutcome, type OscarSyncOutcome } from "@/lib/pathways-directory";
import { corsHeaders, handleOptions, isAuthorized, unauthorized } from "@/lib/oscar-sync-bookmarklet";

export const runtime = "nodejs";

type ResultEntry = { linkId: string } & OscarSyncOutcome;

function isValidEntry(e: unknown): e is ResultEntry {
  if (typeof e !== "object" || e === null) return false;
  const r = e as ResultEntry;
  if (typeof r.linkId !== "string" || !r.linkId) return false;
  if (r.status === "LINKED") return typeof r.oscarSpecId === "string" && typeof r.oscarServiceName === "string";
  if (r.status === "FAILED") return typeof r.errorMessage === "string";
  return false;
}

export async function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized(request);

  let results: unknown;
  try {
    results = (await request.json())?.results;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders(request) });
  }
  if (!Array.isArray(results) || !results.every(isValidEntry)) {
    return NextResponse.json(
      { error: "body.results must be an array of {linkId, status, ...} outcomes" },
      { status: 400, headers: corsHeaders(request) },
    );
  }

  try {
    for (const { linkId, ...outcome } of results) {
      await recordOscarSyncOutcome(linkId, outcome as OscarSyncOutcome);
    }
    return NextResponse.json({ recorded: results.length }, { headers: corsHeaders(request) });
  } catch (err) {
    console.error("[oscar-sync/result] failed:", err);
    return NextResponse.json({ error: "Failed to record results" }, { status: 502, headers: corsHeaders(request) });
  }
}
