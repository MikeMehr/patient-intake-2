/**
 * POST /api/cron/oscar-bulk-queue?limitPerCity=N — pre-load OSCAR's consultation list with the
 * specialists a physician is most likely to actually need, so manual one-off adds become rare.
 *
 * Selection: the fastest N per (specialty, city), NOT the fastest N per specialty province-wide.
 * Ranking on wait time alone skews hard toward Vancouver — measured on the real data, a top-30
 * Gastroenterology list contained 18 Vancouver entries and zero anywhere in the Surrey/Delta/
 * White Rock area, which defeats the point for a practice whose patients want someone close to
 * home. Partitioning by city guarantees every specialty has its fastest few in every city.
 *
 * Specialists with no published wait time are excluded — there's no basis to rank them, and
 * PathwaysBC leaves it blank for well over half the directory.
 *
 * Idempotent: ON CONFLICT DO NOTHING, so re-running after a partial transfer only adds what's
 * missing and never disturbs rows already LINKED.
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

const HEADER_NAME = "x-cron-secret";
const DEFAULT_LIMIT_PER_CITY = 5;
const MAX_LIMIT_PER_CITY = 25;

export async function POST(request: NextRequest) {
  const secret = request.headers.get(HEADER_NAME);
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = Number(request.nextUrl.searchParams.get("limitPerCity"));
  const limitPerCity = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT_PER_CITY) : DEFAULT_LIMIT_PER_CITY;

  const orgs = await query<{ organization_id: string }>(
    `SELECT organization_id FROM emr_connections WHERE vendor = 'OSCAR'`,
  );
  if (orgs.rows.length === 0) {
    return NextResponse.json({ error: "No OSCAR-connected organization found" }, { status: 404 });
  }

  const results: Array<{ organizationId: string; queued: number; alreadyTracked: number; selected: number }> = [];

  for (const { organization_id: orgId } of orgs.rows) {
    const inserted = await query(
      `WITH ranked AS (
         SELECT id,
                ROW_NUMBER() OVER (PARTITION BY specialization, city ORDER BY wait_time_rank, name) AS rn
         FROM bc_specialist_directory
         WHERE active = TRUE AND wait_time_rank IS NOT NULL AND city IS NOT NULL
       )
       INSERT INTO bc_specialist_oscar_link (organization_id, bc_specialist_id, status)
       SELECT $1, id, 'QUEUED' FROM ranked WHERE rn <= $2
       ON CONFLICT (organization_id, bc_specialist_id) DO NOTHING`,
      [orgId, limitPerCity],
    );

    const selected = await query<{ n: string }>(
      `WITH ranked AS (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY specialization, city ORDER BY wait_time_rank, name) AS rn
         FROM bc_specialist_directory
         WHERE active = TRUE AND wait_time_rank IS NOT NULL AND city IS NOT NULL
       )
       SELECT count(*)::text AS n FROM ranked WHERE rn <= $1`,
      [limitPerCity],
    );

    const queued = inserted.rowCount ?? 0;
    const total = Number(selected.rows[0]?.n ?? 0);
    results.push({ organizationId: orgId, queued, alreadyTracked: total - queued, selected: total });
  }

  return NextResponse.json({ limitPerCity, results });
}
