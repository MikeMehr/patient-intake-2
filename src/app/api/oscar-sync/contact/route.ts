/**
 * POST /api/oscar-sync/contact?t=TOKEN — accept office contact info scraped from a PathwaysBC
 * profile page the physician is currently looking at.
 *
 * Exists because PathwaysBC profile pages are login-gated (verified: an unauthenticated request
 * 302s to login), so the server can never fetch this itself — it has to come from a browser that
 * already has the physician's PathwaysBC session.
 *
 * Takes the raw page text and parses it server-side with the same parser the monthly job uses
 * (src/lib/pathways/profile-parse.ts), so there's exactly one implementation of that parsing to
 * keep correct rather than a copy embedded in the bookmarklet.
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { applyContactBackfill } from "@/lib/pathways-directory";
import { parseSpecialistProfileText } from "@/lib/pathways/profile-parse";
import { corsHeaders, handleOptions, isAuthorized, unauthorized } from "@/lib/oscar-sync-bookmarklet";

export const runtime = "nodejs";

export async function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized(request);

  let pathwaysId: unknown;
  let pageText: unknown;
  try {
    const body = await request.json();
    pathwaysId = body?.pathwaysId;
    pageText = body?.pageText;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders(request) });
  }

  if (typeof pathwaysId !== "number" || typeof pageText !== "string" || !pageText) {
    return NextResponse.json(
      { error: "pathwaysId (number) and pageText (string) are required" },
      { status: 400, headers: corsHeaders(request) },
    );
  }

  const contact = parseSpecialistProfileText(pageText);
  if (!contact.phone || !contact.clinicAddress) {
    return NextResponse.json(
      { error: "Couldn't find both an office phone and address on that page.", parsed: contact },
      { status: 422, headers: corsHeaders(request) },
    );
  }

  const row = await query<{ id: string; name: string }>(
    `SELECT id, name FROM bc_specialist_directory WHERE pathways_id = $1 AND active = TRUE`,
    [pathwaysId],
  );
  const specialist = row.rows[0];
  if (!specialist) {
    return NextResponse.json(
      { error: `No active directory entry for PathwaysBC id ${pathwaysId}.` },
      { status: 404, headers: corsHeaders(request) },
    );
  }

  try {
    await applyContactBackfill([{ bcSpecialistId: specialist.id, ...contact }]);
    return NextResponse.json({ name: specialist.name, contact }, { headers: corsHeaders(request) });
  } catch (err) {
    console.error("[oscar-sync/contact] failed:", err);
    return NextResponse.json({ error: "Failed to save contact info" }, { status: 502, headers: corsHeaders(request) });
  }
}
