/**
 * POST /api/cron/oscar-bulk-queue?limitPerCity=N&region=lower-mainland&prune=true
 *
 * Pre-loads OSCAR's consultation list with the specialists a physician is most likely to need, so
 * manual one-off adds become rare.
 *
 * Selection: the fastest N per (specialty, city), NOT the fastest N per specialty province-wide.
 * Ranking on wait time alone skews hard toward Vancouver — measured on the real data, a top-30
 * Gastroenterology list held 18 Vancouver entries and zero anywhere in the Surrey/Delta/White
 * Rock area, which defeats the point for a practice whose patients want someone close to home.
 *
 * Restricted by default to the Lower Mainland: this clinic's patients are here, and a province-
 * wide pass fills OSCAR's picker with Cranbrook, Duncan and Terrace entries that will never be
 * referred to. Pass region=all to override.
 *
 * Specialists with no published wait time are excluded — there's no basis to rank them, and
 * PathwaysBC leaves it blank for well over half the directory.
 *
 * Idempotent. `prune=true` additionally removes QUEUED rows that fall outside the current
 * selection (e.g. after narrowing the region), and never touches LINKED or FAILED rows — those
 * record work already done in OSCAR.
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

const HEADER_NAME = "x-cron-secret";
const DEFAULT_LIMIT_PER_CITY = 5;
const MAX_LIMIT_PER_CITY = 25;

/**
 * Metro Vancouver + Fraser Valley, as PathwaysBC spells them. Deliberately a list rather than a
 * radius: PathwaysBC has no coordinates in the export, and an explicit list is auditable by the
 * physician, who is the one who knows where they actually refer.
 */
const LOWER_MAINLAND_CITIES = [
  "Vancouver", "North Vancouver", "West Vancouver", "Burnaby", "New Westminster", "Richmond",
  "Delta", "North Delta", "Tsawwassen", "Surrey", "South Surrey", "White Rock", "Langley",
  "Fort Langley", "Aldergrove", "Coquitlam", "Port Coquitlam", "Port Moody", "Maple Ridge",
  "Pitt Meadows", "Mission", "Abbotsford", "Chilliwack", "Agassiz", "Hope", "Bowen Island",
  "Lions Bay", "Squamish",
];

export async function POST(request: NextRequest) {
  const secret = request.headers.get(HEADER_NAME);
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const raw = Number(sp.get("limitPerCity"));
  const limitPerCity = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT_PER_CITY) : DEFAULT_LIMIT_PER_CITY;
  const allRegions = sp.get("region") === "all";
  const prune = sp.get("prune") === "true";
  const cities = allRegions ? null : LOWER_MAINLAND_CITIES;

  const orgs = await query<{ organization_id: string }>(
    `SELECT organization_id FROM emr_connections WHERE vendor = 'OSCAR'`,
  );
  if (orgs.rows.length === 0) {
    return NextResponse.json({ error: "No OSCAR-connected organization found" }, { status: 404 });
  }

  // One definition of "selected", reused for the insert, the prune and the count, so they can't
  // drift apart.
  const selectedCte = `
    WITH selected AS (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY specialization, city ORDER BY wait_time_rank, name) AS rn
        FROM bc_specialist_directory
        WHERE active = TRUE AND wait_time_rank IS NOT NULL AND city IS NOT NULL
          AND ($2::text[] IS NULL OR city = ANY($2::text[]))
      ) ranked WHERE rn <= $3
    )`;

  const results = [];
  for (const { organization_id: orgId } of orgs.rows) {
    await query(
      `${selectedCte}
       INSERT INTO bc_specialist_oscar_link (organization_id, bc_specialist_id, status)
       SELECT $1, id, 'QUEUED' FROM selected
       ON CONFLICT (organization_id, bc_specialist_id) DO NOTHING`,
      [orgId, cities, limitPerCity],
    );

    let pruned = 0;
    if (prune) {
      const del = await query(
        `${selectedCte}
         DELETE FROM bc_specialist_oscar_link
         WHERE organization_id = $1 AND status = 'QUEUED'
           AND bc_specialist_id NOT IN (SELECT id FROM selected)`,
        [orgId, cities, limitPerCity],
      );
      pruned = del.rowCount ?? 0;
    }

    const counts = await query<{ selected: string; queued: string; linked: string }>(
      `${selectedCte}
       SELECT (SELECT count(*) FROM selected)::text AS selected,
              (SELECT count(*) FROM bc_specialist_oscar_link WHERE organization_id = $1 AND status = 'QUEUED')::text AS queued,
              (SELECT count(*) FROM bc_specialist_oscar_link WHERE organization_id = $1 AND status = 'LINKED')::text AS linked`,
      [orgId, cities, limitPerCity],
    );
    const c = counts.rows[0];
    results.push({
      organizationId: orgId,
      selected: Number(c?.selected ?? 0),
      nowQueued: Number(c?.queued ?? 0),
      alreadyLinked: Number(c?.linked ?? 0),
      prunedFromQueue: pruned,
    });
  }

  return NextResponse.json({ limitPerCity, region: allRegions ? "all" : "lower-mainland", results });
}
