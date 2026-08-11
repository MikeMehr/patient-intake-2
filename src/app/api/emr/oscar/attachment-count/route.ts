/**
 * GET /api/emr/oscar/attachment-count?demographicNo=123
 *
 * How many booking attachments are waiting to be filed into one OSCAR chart.
 * Drives the badge on the eChart's "Chart Attachment" button.
 *
 * PUBLIC BY NECESSITY. The caller is a script running on the OSCAR page, which is
 * cross-site to us, so `physician_session` (SameSite=Strict) is never sent and any
 * session check here would 401 every time. Compare /api/emr/oscar/billing-dx, which
 * is public for the same structural reason.
 *
 * So it is built to be safe while unauthenticated:
 *   - returns a COUNT ONLY. No filenames, no patient name, no reason, nothing about
 *     the file itself. The popup behind the button is session-protected and is where
 *     any actual detail lives.
 *   - the Origin must be an allow-listed OSCAR server, and the count is scoped to the
 *     organization whose OSCAR connection *is* that origin — so one clinic's eChart can
 *     never count another clinic's files, even with a guessed demographic number.
 *   - rate limited per IP, because a bare count is still worth denying to a scraper
 *     enumerating demographic numbers.
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { consumeRateLimit, getRequestIp } from "@/lib/invitation-security";
import { resolveAllowedOpenerOrigin } from "@/lib/oscar/launch-origins";

export const runtime = "nodejs";

const ROUTE = "/api/emr/oscar/attachment-count";
const DEMOGRAPHIC_NO_RE = /^[0-9]{1,12}$/;

/**
 * The calling OSCAR origin, or null.
 *
 * The Origin header must be PRESENT — not merely allow-listed once resolved.
 * resolveAllowedOpenerOrigin falls back to the single configured origin when given
 * nothing, which is right for the popup (a same-origin opener legitimately sends no
 * origin) but wrong here: a missing Origin means the caller is not a browser making a
 * cross-site request, i.e. exactly the curl-style enumeration this endpoint exists to
 * refuse. Without this check the allow-list is bypassed by simply omitting the header.
 */
function callerOrigin(request: NextRequest): string | null {
  const header = request.headers.get("origin");
  if (!header || !header.trim()) return null;
  return resolveAllowedOpenerOrigin(header);
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** CORS for exactly the calling OSCAR origin — never a wildcard. */
function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}

export async function OPTIONS(request: NextRequest) {
  const origin = callerOrigin(request);
  if (!origin) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, {
    status: 204,
    headers: { ...corsHeaders(origin), "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();

  try {
    // The allow-list is the whole authentication story here, so it comes first.
    const origin = callerOrigin(request);
    if (!origin) {
      logRequestMeta(ROUTE, requestId, 403, Date.now() - started);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rl = await consumeRateLimit(`oscar-attach-count:${getRequestIp(request.headers)}`, 120, 60);
    if (!rl.allowed) {
      logRequestMeta(ROUTE, requestId, 429, Date.now() - started);
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { ...corsHeaders(origin), "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const demographicNo = (request.nextUrl.searchParams.get("demographicNo") ?? "").trim();
    if (!DEMOGRAPHIC_NO_RE.test(demographicNo)) {
      logRequestMeta(ROUTE, requestId, 400, Date.now() - started);
      return NextResponse.json({ error: "Invalid demographicNo" }, { status: 400, headers: corsHeaders(origin) });
    }

    // Which clinic is this OSCAR? Matched on the connection's own base_url, so the
    // count can only ever cover the organization that actually owns this EMR.
    const originHost = hostOf(origin);
    const conns = await query<{ organization_id: string; base_url: string }>(
      `SELECT organization_id, base_url FROM emr_connections WHERE vendor = 'OSCAR'`,
    );
    const orgIds = conns.rows
      .filter((c) => hostOf(c.base_url) === originHost)
      .map((c) => c.organization_id);

    if (!orgIds.length) {
      // Allow-listed origin with no matching connection: nothing to report, and
      // deliberately not an error the caller can distinguish from "none waiting".
      logRequestMeta(ROUTE, requestId, 200, Date.now() - started);
      return NextResponse.json({ count: 0 }, { headers: corsHeaders(origin) });
    }

    const result = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM appointment_files f
       JOIN appointments a ON a.id = f.appointment_id
       WHERE a.organization_id = ANY($1::uuid[])
         AND a.oscar_demographic_no = $2
         AND f.imported_to_oscar_at IS NULL`,
      [orgIds, demographicNo],
    );

    logRequestMeta(ROUTE, requestId, 200, Date.now() - started);
    return NextResponse.json(
      { count: Number(result.rows[0]?.count ?? 0) },
      { headers: corsHeaders(origin) },
    );
  } catch (error) {
    console.error(`[${ROUTE}] Error:`, error);
    logRequestMeta(ROUTE, requestId, 500, Date.now() - started);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
