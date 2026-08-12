/**
 * Shared auth + CORS for the self-service OSCAR sync bookmarklet (/api/oscar-sync/*).
 *
 * These endpoints are called by JS running in the physician's own browser on a THIRD-PARTY origin
 * (oscar.mymdonline.ca, or pathwaysbc.ca for the contact grab) — the whole point is to reuse the
 * OSCAR/PathwaysBC session the physician already has, which only exists on those origins. That
 * means the app's normal session cookie can't authenticate the call: it's `SameSite=strict`
 * (see createSession in src/lib/auth.ts), so the browser won't send it cross-site at all.
 *
 * Hence a bearer token, deliberately SEPARATE from CRON_SECRET: this one is pasted into a
 * bookmark on a clinic machine, so it's far more exposed than a server-side secret. Scoping it to
 * only these routes bounds the damage if it leaks — worst case someone reads the queue of
 * publicly-listed specialist names (no PHI) and marks link rows. It cannot touch patient data,
 * and it cannot trigger the other /api/cron/* jobs.
 */

import { NextRequest, NextResponse } from "next/server";

/** Origins the bookmarklet legitimately runs on. Never widen this to "*" — see the file header. */
const ALLOWED_ORIGINS = new Set(["https://oscar.mymdonline.ca", "https://pathwaysbc.ca", "https://www.pathwaysbc.ca"]);

export function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

/** Preflight — required because the bookmarklet POSTs JSON (not a "simple" request). */
export function handleOptions(request: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

/**
 * The token travels as a query param rather than a header: it has to survive being embedded in a
 * `javascript:` bookmark URL, and a custom header would add nothing here — the token is equally
 * visible either way to anyone who can read the bookmark.
 */
export function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.OSCAR_SYNC_TOKEN;
  if (!expected) return false;
  const provided = request.nextUrl.searchParams.get("t");
  return provided === expected;
}

export function unauthorized(request: NextRequest): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders(request) });
}
