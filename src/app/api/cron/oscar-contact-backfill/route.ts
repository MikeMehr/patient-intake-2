/**
 * POST /api/cron/oscar-contact-backfill — apply PathwaysBC office contact info to
 * bc_specialist_contact_cache. Gated by the same x-cron-secret convention as the other
 * /api/cron/* routes.
 *
 * Accepts either shape in `body.results`:
 *   - {pathwaysId, pageText}   → parsed here, server-side (what the bulk backfill script sends)
 *   - {bcSpecialistId, phone, clinicAddress, ...} → already parsed
 * The raw-text form exists so callers never carry a second copy of the profile parser; PathwaysBC
 * profile pages are login-gated, so the text can only come from something holding a session, but
 * the *parsing* belongs in one place (src/lib/pathways/profile-parse.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { applyContactBackfill, type ContactBackfillResult } from "@/lib/pathways-directory";
import { parseSpecialistProfileText } from "@/lib/pathways/profile-parse";

export const runtime = "nodejs";

const HEADER_NAME = "x-cron-secret";

type RawEntry = { pathwaysId: number; pageText: string };

function isRawEntry(r: unknown): r is RawEntry {
  const e = r as RawEntry;
  return typeof e === "object" && e !== null && typeof e.pathwaysId === "number" && typeof e.pageText === "string";
}

function isParsedResult(r: unknown): r is ContactBackfillResult {
  return typeof r === "object" && r !== null && typeof (r as ContactBackfillResult).bcSpecialistId === "string";
}

/** Resolve raw {pathwaysId, pageText} entries into parsed rows, dropping ones OSCAR can't use. */
async function resolveRawEntries(entries: RawEntry[]): Promise<{ parsed: ContactBackfillResult[]; skipped: number }> {
  const ids = entries.map((e) => e.pathwaysId);
  const rows = await query<{ id: string; pathways_id: number }>(
    `SELECT id, pathways_id FROM bc_specialist_directory WHERE pathways_id = ANY($1::int[]) AND active = TRUE`,
    [ids],
  );
  const byPathwaysId = new Map(rows.rows.map((r) => [r.pathways_id, r.id]));

  const parsed: ContactBackfillResult[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const bcSpecialistId = byPathwaysId.get(entry.pathwaysId);
    if (!bcSpecialistId) {
      skipped++;
      continue;
    }
    const contact = parseSpecialistProfileText(entry.pageText);
    // OSCAR rejects a specialist without both, so a row missing either is not worth caching —
    // leaving it absent also means a later re-run will retry it rather than treat it as done.
    if (!contact.phone || !contact.clinicAddress) {
      skipped++;
      continue;
    }
    parsed.push({ bcSpecialistId, ...contact });
  }
  return { parsed, skipped };
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get(HEADER_NAME);
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let results: unknown;
  try {
    results = (await request.json())?.results;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(results) || results.length === 0) {
    return NextResponse.json({ error: "body.results must be a non-empty array" }, { status: 400 });
  }

  let toApply: ContactBackfillResult[];
  let skipped = 0;
  if (results.every(isRawEntry)) {
    const resolved = await resolveRawEntries(results);
    toApply = resolved.parsed;
    skipped = resolved.skipped;
  } else if (results.every(isParsedResult)) {
    toApply = results;
  } else {
    return NextResponse.json(
      { error: "body.results must be all {pathwaysId, pageText} or all parsed contact rows" },
      { status: 400 },
    );
  }

  try {
    const outcome = await applyContactBackfill(toApply);
    return NextResponse.json({ ...outcome, skipped });
  } catch (err) {
    console.error("[cron/oscar-contact-backfill] failed:", err);
    return NextResponse.json({ error: "Failed to apply contact backfill" }, { status: 502 });
  }
}
