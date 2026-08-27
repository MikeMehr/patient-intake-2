/**
 * GET/POST /api/emr/oscar/booking-block
 *
 * Server-to-server endpoint for the OSCAR Master Chart's "Block online booking"
 * button (infrastructure/oscar-patches/booking-block/bookingBlock.jsp — the JSP
 * proxies the physician's click from the OSCAR box, so the shared secret never
 * reaches a browser).
 *
 * Auth: x-booking-block-secret header must equal OSCAR_BOOKING_BLOCK_SECRET.
 * With the env var unset the endpoint is disabled (503), never open.
 *
 *   GET  ?clinicSlug=…&demographicNo=…            → { blocked: boolean }
 *   POST { clinicSlug, demographicNo, blocked, providerNo? } → { blocked: boolean }
 *
 * Responses carry no PHI — only the flag for a demographic number the caller
 * already holds.
 */

import { NextRequest, NextResponse } from "next/server";
import { getClinicBySlug } from "@/lib/booking-store";
import {
  clearBookingBlock,
  isBookingBlocked,
  setBookingBlock,
} from "@/lib/booking-blocks";

export const runtime = "nodejs";

const HEADER_NAME = "x-booking-block-secret";

function authorized(req: NextRequest): boolean {
  const expected = process.env.OSCAR_BOOKING_BLOCK_SECRET;
  return Boolean(expected) && req.headers.get(HEADER_NAME) === expected;
}

async function resolveOrgId(clinicSlug: string): Promise<string | null> {
  if (!clinicSlug) return null;
  const clinic = await getClinicBySlug(clinicSlug);
  return clinic?.id ?? null;
}

export async function GET(req: NextRequest) {
  if (!process.env.OSCAR_BOOKING_BLOCK_SECRET) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const orgId = await resolveOrgId(String(sp.get("clinicSlug") ?? "").trim());
  const demographicNo = String(sp.get("demographicNo") ?? "").trim();
  if (!orgId || !demographicNo) {
    return NextResponse.json({ error: "clinicSlug and demographicNo are required" }, { status: 400 });
  }

  const blocked = await isBookingBlocked(orgId, demographicNo);
  return NextResponse.json({ blocked });
}

export async function POST(req: NextRequest) {
  if (!process.env.OSCAR_BOOKING_BLOCK_SECRET) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orgId = await resolveOrgId(String(body.clinicSlug ?? "").trim());
  const demographicNo = String(body.demographicNo ?? "").trim();
  if (!orgId || !demographicNo || typeof body.blocked !== "boolean") {
    return NextResponse.json(
      { error: "clinicSlug, demographicNo, and blocked (boolean) are required" },
      { status: 400 }
    );
  }
  const providerNo = String(body.providerNo ?? "").trim().slice(0, 20) || null;

  const ok = body.blocked
    ? await setBookingBlock(orgId, demographicNo, providerNo)
    : await clearBookingBlock(orgId, demographicNo);
  if (!ok) {
    return NextResponse.json({ error: "Invalid demographicNo" }, { status: 400 });
  }

  const blocked = await isBookingBlocked(orgId, demographicNo);
  return NextResponse.json({ blocked });
}
