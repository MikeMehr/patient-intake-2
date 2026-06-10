/**
 * GET /api/org/emr-status — Read-only EMR (OSCAR) connection status for the
 * logged-in org admin's own organization.
 *
 * Reads the same per-organization `emr_connections` row that the super-admin
 * EMR setup writes and the public booking patient-lookup consumes. Returns only
 * non-sensitive status fields — never any keys, secrets, or tokens.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "org_admin" || !session.organizationId) {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/org/emr-status", requestId, status, Date.now() - started);
      return res;
    }

    const row = (
      await query<{
        status: string;
        base_url: string;
        last_tested_at: string | null;
        has_tokens: boolean;
      }>(
        `SELECT status, base_url, last_tested_at,
                (access_token_enc IS NOT NULL AND token_secret_enc IS NOT NULL) AS has_tokens
         FROM emr_connections
         WHERE organization_id = $1 AND vendor = 'OSCAR'
         LIMIT 1`,
        [session.organizationId],
      )
    ).rows[0];

    // "Connected" mirrors the booking lookup's own gate: status connected + tokens present.
    const connected = !!row && row.status === "connected" && row.has_tokens;

    const res = NextResponse.json({
      configured: !!row,
      connected,
      status: row?.status ?? "not_configured",
      baseUrl: row?.base_url ?? null,
      lastTestedAt: row?.last_tested_at ?? null,
    });
    logRequestMeta("/api/org/emr-status", requestId, status, Date.now() - started);
    return res;
  } catch (err) {
    status = 500;
    console.error("[/api/org/emr-status] error:", err);
    const res = NextResponse.json({ error: "Internal error" }, { status });
    logRequestMeta("/api/org/emr-status", requestId, status, Date.now() - started);
    return res;
  }
}
