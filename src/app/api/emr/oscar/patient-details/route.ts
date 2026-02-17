import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { decryptString } from "@/lib/encrypted-field";
import { getOscarRestBase, oscarSignedFetch } from "@/lib/oscar/client";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required" }, { status });
      logRequestMeta("/api/emr/oscar/patient-details", requestId, status, Date.now() - started);
      return res;
    }
    if (session.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required" }, { status });
      logRequestMeta("/api/emr/oscar/patient-details", requestId, status, Date.now() - started);
      return res;
    }
    const orgId = session.organizationId;
    if (!orgId) {
      status = 400;
      const res = NextResponse.json({ error: "Provider organization is missing" }, { status });
      logRequestMeta("/api/emr/oscar/patient-details", requestId, status, Date.now() - started);
      return res;
    }

    const body = (await request.json()) as { demographicNo?: string };
    const demographicNo = String(body.demographicNo || "").trim();
    if (!demographicNo) {
      status = 400;
      const res = NextResponse.json({ error: "demographicNo is required" }, { status });
      logRequestMeta("/api/emr/oscar/patient-details", requestId, status, Date.now() - started);
      return res;
    }

    const connRes = await query<{
      base_url: string;
      client_key: string;
      client_secret_enc: string;
      access_token_enc: string | null;
      token_secret_enc: string | null;
      status: string;
    }>(
      `SELECT base_url, client_key, client_secret_enc, access_token_enc, token_secret_enc, status
       FROM emr_connections
       WHERE organization_id = $1 AND vendor = 'OSCAR'
       LIMIT 1`,
      [orgId],
    );
    if (connRes.rows.length === 0) {
      status = 400;
      const res = NextResponse.json({ error: "OSCAR is not configured for this organization" }, { status });
      logRequestMeta("/api/emr/oscar/patient-details", requestId, status, Date.now() - started);
      return res;
    }
    const conn = connRes.rows[0];
    if (conn.status !== "connected" || !conn.access_token_enc || !conn.token_secret_enc) {
      status = 400;
      const res = NextResponse.json({ error: "OSCAR is not connected for this organization" }, { status });
      logRequestMeta("/api/emr/oscar/patient-details", requestId, status, Date.now() - started);
      return res;
    }

    const clientSecret = decryptString(conn.client_secret_enc);
    const accessToken = decryptString(conn.access_token_enc);
    const tokenSecret = decryptString(conn.token_secret_enc);
    const restBase = getOscarRestBase(conn.base_url);

    const oscarRes = await oscarSignedFetch({
      method: "GET",
      url: `${restBase}/demographics/${encodeURIComponent(demographicNo)}`,
      clientKey: conn.client_key,
      clientSecret,
      accessToken,
      tokenSecret,
    });

    const rawText = await oscarRes.text();
    if (!oscarRes.ok) {
      status = 502;
      const res = NextResponse.json(
        { error: `OSCAR details failed (${oscarRes.status})`, details: rawText.slice(0, 500) },
        { status },
      );
      logRequestMeta("/api/emr/oscar/patient-details", requestId, status, Date.now() - started);
      return res;
    }

    let json: any = null;
    try {
      json = JSON.parse(rawText);
    } catch {
      status = 502;
      const res = NextResponse.json({ error: "OSCAR details returned non-JSON", details: rawText.slice(0, 500) }, { status });
      logRequestMeta("/api/emr/oscar/patient-details", requestId, status, Date.now() - started);
      return res;
    }

    // Try to normalize common demographic fields across deployments.
    const primaryPhone =
      String(json.phone ?? json.phoneNumber ?? json.primaryPhone ?? json.phone1 ?? "").trim() || null;
    const secondaryPhone =
      String(json.phone2 ?? json.secondaryPhone ?? json.alternatePhone ?? "").trim() || null;
    const insuranceNumber =
      String(json.hin ?? json.healthInsuranceNumber ?? json.insuranceNumber ?? json.hcNumber ?? "").trim() || null;

    const addressParts = [
      json.address ?? json.streetAddress ?? json.address1,
      json.city,
      json.province ?? json.state,
      json.postal ?? json.postalCode ?? json.zip,
    ]
      .map((v: any) => String(v || "").trim())
      .filter((v: string) => v.length > 0);
    const patientAddress = addressParts.length ? addressParts.join(", ") : null;

    const dateOfBirth = String(json.dob ?? json.dateOfBirth ?? json.birthDate ?? "").trim() || null;
    const firstName = String(json.firstName ?? json.first_name ?? json.givenName ?? "").trim() || null;
    const lastName = String(json.lastName ?? json.last_name ?? json.surname ?? "").trim() || null;

    const res = NextResponse.json({
      demographicNo,
      firstName,
      lastName,
      dateOfBirth,
      primaryPhone,
      secondaryPhone,
      insuranceNumber,
      patientAddress,
    });
    logRequestMeta("/api/emr/oscar/patient-details", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[emr/oscar/patient-details] Error", error);
    const res = NextResponse.json({ error: "Failed to fetch patient details from OSCAR" }, { status });
    logRequestMeta("/api/emr/oscar/patient-details", requestId, status, Date.now() - started);
    return res;
  }
}

