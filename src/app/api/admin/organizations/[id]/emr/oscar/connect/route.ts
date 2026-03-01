import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { decryptString, encryptString } from "@/lib/encrypted-field";
import { oscarAuthorizeUrl, oscarInitiate } from "@/lib/oscar/client";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getExpectedTokenClaims } from "@/lib/token-claims";

export const runtime = "nodejs";

function getAppBaseUrl(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env && env.trim()) return env.trim().replace(/\/+$/, "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") || "http";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "super_admin") {
      status = 401;
      const res = NextResponse.json({ error: "Unauthorized" }, { status });
      logRequestMeta("/api/admin/organizations/[id]/emr/oscar/connect", requestId, status, Date.now() - started);
      return res;
    }

    const { id: orgId } = await params;
    const connectionRes = await query<{
      base_url: string;
      client_key: string;
      client_secret_enc: string;
    }>(
      `SELECT base_url, client_key, client_secret_enc
       FROM emr_connections
       WHERE organization_id = $1 AND vendor = 'OSCAR'
       LIMIT 1`,
      [orgId],
    );

    if (connectionRes.rows.length === 0) {
      status = 400;
      const res = NextResponse.json({ error: "OSCAR is not configured for this organization" }, { status });
      logRequestMeta("/api/admin/organizations/[id]/emr/oscar/connect", requestId, status, Date.now() - started);
      return res;
    }

    const row = connectionRes.rows[0];
    const clientSecret = decryptString(row.client_secret_enc);
    // Use a constant callback URL. OSCAR frequently rejects callback URLs
    // that include query params; we can resolve org by request token instead.
    const callbackUrl = `${getAppBaseUrl(request)}/api/admin/emr/oscar/callback`;

    const temp = await oscarInitiate({
      oscarBaseUrl: row.base_url,
      clientKey: row.client_key,
      clientSecret,
      callbackUrl,
    });

    const claims = getExpectedTokenClaims("oauth_request", "emr_oscar_oauth_request");

    await query(
      `INSERT INTO emr_oauth_requests (
         organization_id, vendor, state, request_token, request_token_secret_enc, expires_at,
         token_iss, token_aud, token_type, token_context
       ) VALUES ($1, 'OSCAR', $2, $3, $4, NOW() + INTERVAL '15 minutes', $5, $6, $7, $8)
       ON CONFLICT (vendor, state)
       DO UPDATE SET
         request_token = EXCLUDED.request_token,
         request_token_secret_enc = EXCLUDED.request_token_secret_enc,
         expires_at = EXCLUDED.expires_at,
         token_iss = EXCLUDED.token_iss,
         token_aud = EXCLUDED.token_aud,
         token_type = EXCLUDED.token_type,
         token_context = EXCLUDED.token_context`,
      // state is stored for troubleshooting/audit, but is not required in callback.
      [
        orgId,
        `rt:${temp.requestToken}`,
        temp.requestToken,
        encryptString(temp.requestTokenSecret),
        claims.iss,
        claims.aud,
        claims.type,
        claims.context,
      ],
    );

    const authorizeUrl = oscarAuthorizeUrl({
      oscarBaseUrl: row.base_url,
      requestToken: temp.requestToken,
    });

    const res = NextResponse.json({ authorizeUrl });
    logRequestMeta("/api/admin/organizations/[id]/emr/oscar/connect", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/emr/oscar/connect] Error", error);
    const safeDetails =
      error instanceof Error && error.message.startsWith("OSCAR initiate failed")
        ? error.message
        : undefined;
    const res = NextResponse.json(
      {
        error: "Failed to initiate OSCAR connection",
        details: safeDetails,
      },
      { status },
    );
    logRequestMeta("/api/admin/organizations/[id]/emr/oscar/connect", requestId, status, Date.now() - started);
    return res;
  }
}

