/**
 * POST /api/cron/oscar-contact-backfill — apply scraped PathwaysBC profile contact info
 * (src/lib/pathways/profile-parse.ts, browser-driven — PathwaysBC needs a real login session, no
 * server-side fetch is possible) to bc_specialist_contact_cache.
 * Gated by the same x-cron-secret convention as the other /api/cron/* routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { applyContactBackfill, type ContactBackfillResult } from "@/lib/pathways-directory";

export const runtime = "nodejs";

const HEADER_NAME = "x-cron-secret";

function isValidResult(r: unknown): r is ContactBackfillResult {
  return typeof r === "object" && r !== null && typeof (r as ContactBackfillResult).bcSpecialistId === "string";
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get(HEADER_NAME);
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let results: unknown;
  try {
    const body = await request.json();
    results = body?.results;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(results) || !results.every(isValidResult)) {
    return NextResponse.json({ error: "body.results must be an array of contact-backfill results" }, { status: 400 });
  }

  try {
    const outcome = await applyContactBackfill(results);
    return NextResponse.json(outcome);
  } catch (err) {
    console.error("[cron/oscar-contact-backfill] failed:", err);
    return NextResponse.json({ error: "Failed to apply contact backfill" }, { status: 502 });
  }
}
