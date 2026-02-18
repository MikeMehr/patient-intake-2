import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { decryptString } from "@/lib/encrypted-field";
import { getOscarRestBase, oscarSignedFetch } from "@/lib/oscar/client";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickFirstNonEmptyString(obj: any, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj?.[key];
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function normalizeAddressFromOscar(json: any): string | null {
  const top = json ?? {};
  const addrObj = isRecord(top.address) ? (top.address as any) : null;

  const street =
    pickFirstNonEmptyString(top, ["streetAddress", "address1", "address", "street", "line1", "line_1"]) ??
    (addrObj
      ? pickFirstNonEmptyString(addrObj, ["streetAddress", "address1", "address", "street", "line1", "line_1"])
      : null) ??
    // Some deployments split street number/name
    (() => {
      const num =
        pickFirstNonEmptyString(top, ["streetNumber", "street_no", "streetNum"]) ??
        (addrObj ? pickFirstNonEmptyString(addrObj, ["streetNumber", "street_no", "streetNum"]) : null);
      const name =
        pickFirstNonEmptyString(top, ["streetName", "street_name"]) ??
        (addrObj ? pickFirstNonEmptyString(addrObj, ["streetName", "street_name"]) : null);
      const combined = [num, name].filter(Boolean).join(" ").trim();
      return combined || null;
    })();

  const unit =
    pickFirstNonEmptyString(top, ["unit", "suite", "apt", "apartment"]) ??
    (addrObj ? pickFirstNonEmptyString(addrObj, ["unit", "suite", "apt", "apartment"]) : null);

  const city =
    pickFirstNonEmptyString(top, ["city", "municipality", "town"]) ??
    (addrObj ? pickFirstNonEmptyString(addrObj, ["city", "municipality", "town"]) : null);
  const province =
    pickFirstNonEmptyString(top, ["province", "state", "prov"]) ??
    (addrObj ? pickFirstNonEmptyString(addrObj, ["province", "state", "prov"]) : null);
  const postal =
    pickFirstNonEmptyString(top, ["postal", "postalCode", "zip"]) ??
    (addrObj ? pickFirstNonEmptyString(addrObj, ["postal", "postalCode", "zip"]) : null);

  const streetLine = [street, unit ? `Unit ${unit}` : null].filter(Boolean).join(", ").trim();
  const parts = [streetLine, city, province, postal].filter((p) => typeof p === "string" && p.trim().length > 0);
  return parts.length ? parts.join(", ") : null;
}

function normalizeEmailFromOscar(json: any): string | null {
  const top = json ?? {};
  const contactObj = isRecord(top.contact) ? (top.contact as any) : null;
  const emailsObj = isRecord(top.emails) ? (top.emails as any) : null;

  // Try common OSCAR demographic field names (varies by deployment).
  const candidate =
    pickFirstNonEmptyString(top, ["email", "emailAddress", "email_address", "eMail", "patientEmail"]) ??
    (contactObj
      ? pickFirstNonEmptyString(contactObj, ["email", "emailAddress", "email_address", "eMail"])
      : null) ??
    (emailsObj
      ? pickFirstNonEmptyString(emailsObj, ["primary", "email", "emailAddress", "email_address"])
      : null);

  if (!candidate) return null;
  const normalized = candidate.trim();
  // Very lightweight validation: avoid returning junk strings.
  if (!normalized.includes("@") || normalized.length > 254) return null;
  return normalized;
}

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

    const patientAddress = normalizeAddressFromOscar(json);
    const patientEmail = normalizeEmailFromOscar(json);

    const dateOfBirth = String(json.dob ?? json.dateOfBirth ?? json.birthDate ?? "").trim() || null;
    const firstName = String(json.firstName ?? json.first_name ?? json.givenName ?? "").trim() || null;
    const lastName = String(json.lastName ?? json.last_name ?? json.surname ?? "").trim() || null;

    const res = NextResponse.json({
      demographicNo,
      firstName,
      lastName,
      dateOfBirth,
      patientEmail,
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

