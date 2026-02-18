import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { decryptString } from "@/lib/encrypted-field";
import { getOscarRestBase, oscarSignedFetch } from "@/lib/oscar/client";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

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
      logRequestMeta("/api/admin/organizations/[id]/emr/oscar/test", requestId, status, Date.now() - started);
      return res;
    }

    const { id: orgId } = await params;
    const result = await query<{
      base_url: string;
      client_key: string;
      client_secret_enc: string;
      access_token_enc: string | null;
      token_secret_enc: string | null;
    }>(
      `SELECT base_url, client_key, client_secret_enc, access_token_enc, token_secret_enc
       FROM emr_connections
       WHERE organization_id = $1 AND vendor = 'OSCAR'
       LIMIT 1`,
      [orgId],
    );
    if (result.rows.length === 0) {
      status = 400;
      const res = NextResponse.json({ error: "OSCAR is not configured" }, { status });
      logRequestMeta("/api/admin/organizations/[id]/emr/oscar/test", requestId, status, Date.now() - started);
      return res;
    }
    const row = result.rows[0];
    if (!row.access_token_enc || !row.token_secret_enc) {
      status = 400;
      const res = NextResponse.json({ error: "OSCAR is not connected yet (missing tokens)" }, { status });
      logRequestMeta("/api/admin/organizations/[id]/emr/oscar/test", requestId, status, Date.now() - started);
      return res;
    }

    const clientSecret = decryptString(row.client_secret_enc);
    const accessToken = decryptString(row.access_token_enc);
    const tokenSecret = decryptString(row.token_secret_enc);

    // Harmless test call: authentication check endpoint (exists in OSCAR RS WADL).
    const restBase = getOscarRestBase(row.base_url);
    const resOscar = await oscarSignedFetch({
      method: "GET",
      url: `${restBase}/status/checkIfAuthed`,
      clientKey: row.client_key,
      clientSecret,
      accessToken,
      tokenSecret,
    });

    if (!resOscar.ok) {
      const text = await resOscar.text().catch(() => "");
      const wwwAuth = resOscar.headers.get("www-authenticate") || "";
      status = 502;
      await query(
        `UPDATE emr_connections
         SET status = 'error', last_tested_at = NOW(), updated_at = NOW()
         WHERE organization_id = $1 AND vendor = 'OSCAR'`,
        [orgId],
      );
      const res = NextResponse.json(
        {
          error: `OSCAR test failed (${resOscar.status})`,
          details: text.slice(0, 500),
          wwwAuthenticate: wwwAuth ? wwwAuth.slice(0, 300) : undefined,
        },
        { status },
      );
      logRequestMeta("/api/admin/organizations/[id]/emr/oscar/test", requestId, status, Date.now() - started);
      return res;
    }

    await query(
      `UPDATE emr_connections
       SET status = 'connected', last_tested_at = NOW(), updated_at = NOW()
       WHERE organization_id = $1 AND vendor = 'OSCAR'`,
      [orgId],
    );

    const res = NextResponse.json({ success: true });
    logRequestMeta("/api/admin/organizations/[id]/emr/oscar/test", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/emr/oscar/test] Error", error);
    const res = NextResponse.json({ error: "Failed to test OSCAR connection" }, { status });
    logRequestMeta("/api/admin/organizations/[id]/emr/oscar/test", requestId, status, Date.now() - started);
    return res;
  }
}

