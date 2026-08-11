/**
 * POST /api/cron/pathways-directory-sync — upsert a pre-parsed PathwaysBC export into
 * bc_specialist_directory.
 *
 * Unlike pharmacy-directory-sync, this route can't fetch its own source data: PathwaysBC requires
 * a logged-in browser session (see scripts/pathways-login.js / scripts/pathways-sync.js), which
 * only exists on a real machine, not this server. So the body IS the already-parsed rows
 * (NormalizedSpecialist[], from parsePathwaysGlobalData) — the caller does the PathwaysBC fetch
 * and parsing, and POSTs the result here so the actual DB write goes through the app's own
 * database connection instead of needing prod's Azure-firewalled Postgres opened up to a laptop.
 *
 * Gated by the same x-cron-secret shared secret as the other /api/cron/* routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { syncBcSpecialistDirectory } from "@/lib/pathways-directory";
import type { NormalizedSpecialist } from "@/lib/pathways/parse";

export const runtime = "nodejs";

const HEADER_NAME = "x-cron-secret";

function isValidRow(row: unknown): row is NormalizedSpecialist {
  return (
    typeof row === "object" &&
    row !== null &&
    typeof (row as NormalizedSpecialist).pathwaysId === "number" &&
    typeof (row as NormalizedSpecialist).name === "string" &&
    typeof (row as NormalizedSpecialist).lastName === "string"
  );
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get(HEADER_NAME);
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rows: unknown;
  try {
    const body = await request.json();
    rows = body?.rows;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(rows) || !rows.every(isValidRow)) {
    return NextResponse.json({ error: "body.rows must be an array of parsed PathwaysBC specialists" }, { status: 400 });
  }

  const result = await syncBcSpecialistDirectory(rows);
  if ("error" in result) {
    console.error("[cron/pathways-directory-sync] sync failed:", result.error);
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json(result);
}
