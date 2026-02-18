import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { decryptString, encryptString, maskSecret } from "@/lib/encrypted-field";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

export async function GET(
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
      logRequestMeta("/api/admin/organizations/[id]/emr/oscar", requestId, status, Date.now() - started);
      return res;
    }

    const { id: orgId } = await params;
    const result = await query<{
      base_url: string;
      client_key: string;
      client_secret_enc: string;
      status: string;
      last_tested_at: Date | null;
      token_issued_at: Date | null;
      updated_at: Date | null;
    }>(
      `SELECT base_url, client_key, client_secret_enc, status, last_tested_at, token_issued_at, updated_at
       FROM emr_connections
       WHERE organization_id = $1 AND vendor = 'OSCAR'
       LIMIT 1`,
      [orgId],
    );

    if (result.rows.length === 0) {
      const res = NextResponse.json({ connected: false, status: "not_connected" });
      logRequestMeta("/api/admin/organizations/[id]/emr/oscar", requestId, status, Date.now() - started);
      return res;
    }

    const row = result.rows[0];
    let secretMasked: string | null = null;
    try {
      secretMasked = maskSecret(decryptString(row.client_secret_enc));
    } catch {
      // If encryption key is missing, do not block the UI; just omit the masked secret.
      secretMasked = null;
    }
    const res = NextResponse.json({
      connected: row.status === "connected",
      status: row.status,
      baseUrl: row.base_url,
      clientKey: row.client_key,
      clientSecretMasked: secretMasked,
      lastTestedAt: row.last_tested_at ? row.last_tested_at.toISOString() : null,
      tokenIssuedAt: row.token_issued_at ? row.token_issued_at.toISOString() : null,
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    });
    logRequestMeta("/api/admin/organizations/[id]/emr/oscar", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/emr/oscar] GET error", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/admin/organizations/[id]/emr/oscar", requestId, status, Date.now() - started);
    return res;
  }
}

export async function PUT(
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
      logRequestMeta("/api/admin/organizations/[id]/emr/oscar", requestId, status, Date.now() - started);
      return res;
    }

    const { id: orgId } = await params;
    const body = (await request.json()) as {
      baseUrl?: string;
      clientKey?: string;
      clientSecret?: string;
    };

    const baseUrl = body.baseUrl ? normalizeBaseUrl(body.baseUrl) : "";
    const clientKey = (body.clientKey || "").trim();
    const clientSecret = (body.clientSecret || "").trim();

    if (!baseUrl || !clientKey || !clientSecret) {
      status = 400;
      const res = NextResponse.json(
        { error: "baseUrl, clientKey, and clientSecret are required" },
        { status },
      );
      logRequestMeta("/api/admin/organizations/[id]/emr/oscar", requestId, status, Date.now() - started);
      return res;
    }

    const clientSecretEnc = encryptString(clientSecret);

    await query(
      `INSERT INTO emr_connections (
         organization_id, vendor, base_url, client_key, client_secret_enc, status, updated_at
       )
       VALUES ($1, 'OSCAR', $2, $3, $4, 'not_connected', NOW())
       ON CONFLICT (organization_id, vendor)
       DO UPDATE SET
         base_url = EXCLUDED.base_url,
         client_key = EXCLUDED.client_key,
         client_secret_enc = EXCLUDED.client_secret_enc,
         updated_at = NOW()`,
      [orgId, baseUrl, clientKey, clientSecretEnc],
    );

    const res = NextResponse.json({ success: true });
    logRequestMeta("/api/admin/organizations/[id]/emr/oscar", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/emr/oscar] PUT error", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/admin/organizations/[id]/emr/oscar", requestId, status, Date.now() - started);
    return res;
  }
}

