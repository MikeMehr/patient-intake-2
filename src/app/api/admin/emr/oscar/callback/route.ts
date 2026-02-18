import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { decryptString, encryptString } from "@/lib/encrypted-field";
import { oscarExchangeAccessToken } from "@/lib/oscar/client";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const url = new URL(request.url);
    const oauthToken = (url.searchParams.get("oauth_token") || "").trim();
    const oauthVerifier = (url.searchParams.get("oauth_verifier") || "").trim();

    if (!oauthToken || !oauthVerifier) {
      status = 400;
      const res = NextResponse.json({ error: "Missing required OAuth callback parameters" }, { status });
      logRequestMeta("/api/admin/emr/oscar/callback", requestId, status, Date.now() - started);
      return res;
    }

    const pendingRes = await query<{
      organization_id: string;
      request_token: string;
      request_token_secret_enc: string;
      expires_at: Date;
    }>(
      `SELECT organization_id, request_token, request_token_secret_enc, expires_at
       FROM emr_oauth_requests
       WHERE vendor = 'OSCAR' AND request_token = $1
       LIMIT 1`,
      [oauthToken],
    );
    if (pendingRes.rows.length === 0) {
      status = 400;
      const res = NextResponse.json({ error: "OAuth request not found or expired" }, { status });
      logRequestMeta("/api/admin/emr/oscar/callback", requestId, status, Date.now() - started);
      return res;
    }
    const pending = pendingRes.rows[0];
    if (pending.expires_at.getTime() <= Date.now()) {
      status = 400;
      const res = NextResponse.json({ error: "OAuth request expired; please reconnect" }, { status });
      logRequestMeta("/api/admin/emr/oscar/callback", requestId, status, Date.now() - started);
      return res;
    }

    const orgId = pending.organization_id;
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
      const res = NextResponse.json({ error: "OSCAR connection config missing" }, { status });
      logRequestMeta("/api/admin/emr/oscar/callback", requestId, status, Date.now() - started);
      return res;
    }
    const connection = connectionRes.rows[0];
    const clientSecret = decryptString(connection.client_secret_enc);
    const requestTokenSecret = decryptString(pending.request_token_secret_enc);

    const exchanged = await oscarExchangeAccessToken({
      oscarBaseUrl: connection.base_url,
      clientKey: connection.client_key,
      clientSecret,
      requestToken: oauthToken,
      requestTokenSecret,
      verifier: oauthVerifier,
    });

    await query(
      `UPDATE emr_connections
       SET access_token_enc = $2,
           token_secret_enc = $3,
           status = 'connected',
           token_issued_at = NOW(),
           updated_at = NOW()
       WHERE organization_id = $1 AND vendor = 'OSCAR'`,
      [orgId, encryptString(exchanged.accessToken), encryptString(exchanged.tokenSecret)],
    );

    await query(
      `DELETE FROM emr_oauth_requests
       WHERE vendor = 'OSCAR' AND request_token = $1`,
      [oauthToken],
    );

    const redirectUrl = new URL(`/admin/organizations/${orgId}`, request.url);
    redirectUrl.searchParams.set("oscar", "connected");
    const res = NextResponse.redirect(redirectUrl.toString(), { status: 302 });
    logRequestMeta("/api/admin/emr/oscar/callback", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/emr/oscar/callback] Error", error);
    const res = NextResponse.json({ error: "Failed to complete OSCAR OAuth callback" }, { status });
    logRequestMeta("/api/admin/emr/oscar/callback", requestId, status, Date.now() - started);
    return res;
  }
}
