/**
 * POST /api/booking/[clinicSlug]/create-oscar-patient
 * Public route — creates a new patient demographic in Oscar EMR.
 * Called only when a patient was not found during lookup.
 *
 * Security controls:
 *  - Requires an active booking hold cookie (same gate as lookup-patient).
 *  - Validates all inputs strictly before sending to Oscar.
 *  - Returns only the demographicNo — no Oscar PHI echoed back.
 *
 * Body: {
 *   firstName, lastName, dateOfBirth, email?,
 *   phone, address, city, province, postal
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getClinicBySlug } from "@/lib/booking-store";
import { query } from "@/lib/db";
import { decryptString } from "@/lib/encrypted-field";
import { getOscarRestBase } from "@/lib/oscar/client";
import { signOAuth1Request } from "@/lib/oscar/oauth1";

export const runtime = "nodejs";

const HOLD_COOKIE = "booking_hold_key";
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FIELD_LEN = 200;

function truncate(val: unknown, max = MAX_FIELD_LEN): string {
  return String(val ?? "").trim().slice(0, max);
}

async function oscarPost(
  url: string,
  body: Record<string, string>,
  creds: {
    client_key: string;
    clientSecret: string;
    accessToken: string;
    tokenSecret: string;
  }
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; detail: string }> {
  const bodyStr = JSON.stringify(body);

  const signed = signOAuth1Request({
    method: "POST",
    url,
    consumerKey: creds.client_key,
    consumerSecret: creds.clientSecret,
    token: creds.accessToken,
    tokenSecret: creds.tokenSecret,
  });

  const doFetch = async (useHeader: boolean) => {
    const fetchUrl = useHeader
      ? signed.signedUrl
      : (() => {
          const u = new URL(signed.signedUrl);
          for (const [k, v] of Object.entries(signed.oauthParams)) u.searchParams.set(k, v);
          return u.toString();
        })();
    try {
      return await fetch(fetchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(useHeader ? { Authorization: signed.authorizationHeader } : {}),
        },
        body: bodyStr,
      });
    } catch {
      return null; // network/DNS error
    }
  };

  const res1 = await doFetch(true);
  if (!res1) return { ok: false, status: 503, detail: "Network error reaching Oscar" };
  let res = res1;
  if (!res.ok && res.status === 401) {
    const res2 = await doFetch(false);
    if (!res2) return { ok: false, status: 503, detail: "Network error reaching Oscar" };
    res = res2;
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, detail: text.slice(0, 500) };
  }
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, status: 502, detail: "Non-JSON response from Oscar" };
  }
}

function extractDemographicNo(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as any;
  // Oscar may wrap in content, or return the record directly
  const target = obj.content ?? obj.demographic ?? obj;
  const no = String(
    target?.demographicNo ??
    target?.demographic_no ??
    target?.demographicNumber ??
    target?.id ??
    ""
  ).trim();
  return no || null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> }
) {
  try {
  const { clinicSlug } = await params;

  // Security: require an active hold cookie
  const sessionKey = req.cookies.get(HOLD_COOKIE)?.value;
  if (!sessionKey) {
    return NextResponse.json(
      { error: "No active booking hold. Please select a time slot first." },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const firstName  = truncate(body.firstName);
  const lastName   = truncate(body.lastName);
  const dateOfBirth = truncate(body.dateOfBirth, 10);
  const phone      = truncate(body.phone, 30);
  const address    = truncate(body.address);
  const city       = truncate(body.city, 100);
  const province   = truncate(body.province, 50);
  const postal     = truncate(body.postal, 10);
  const email      = truncate(body.email);

  if (!firstName || !lastName) {
    return NextResponse.json({ error: "firstName and lastName are required" }, { status: 400 });
  }
  if (!DOB_RE.test(dateOfBirth)) {
    return NextResponse.json({ error: "dateOfBirth must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!phone || !address || !city || !province || !postal) {
    return NextResponse.json(
      { error: "phone, address, city, province, and postal are required" },
      { status: 400 }
    );
  }

  // Resolve clinic
  const clinic = await getClinicBySlug(clinicSlug);
  if (!clinic || !clinic.settings?.onlineBookingEnabled) {
    return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
  }

  // Verify the hold cookie belongs to a live hold for this clinic
  const holdCheck = await query<{ id: string }>(
    `SELECT s.id FROM appointment_slots s
     WHERE s.organization_id = $1
       AND s.status = 'HELD'
       AND s.held_session_key = $2
       AND s.held_until > NOW()
     LIMIT 1`,
    [clinic.id, sessionKey]
  );
  if (holdCheck.rows.length === 0) {
    return NextResponse.json(
      { error: "Hold not found or expired. Please select a time slot again." },
      { status: 403 }
    );
  }

  // Fetch Oscar credentials
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
    [clinic.id]
  );

  if (
    connRes.rows.length === 0 ||
    connRes.rows[0]!.status !== "connected" ||
    !connRes.rows[0]!.access_token_enc ||
    !connRes.rows[0]!.token_secret_enc
  ) {
    return NextResponse.json(
      { error: "Oscar EMR is not connected for this clinic" },
      { status: 503 }
    );
  }

  const conn = connRes.rows[0]!;
  const creds = {
    client_key: conn.client_key,
    clientSecret: decryptString(conn.client_secret_enc),
    accessToken: decryptString(conn.access_token_enc!),
    tokenSecret: decryptString(conn.token_secret_enc!),
  };
  const restBase = getOscarRestBase(conn.base_url);

  // Build the Oscar demographic payload
  const demographicPayload: Record<string, string> = {
    firstName,
    lastName,
    dob: dateOfBirth,
    sex: "U",
    phone,
    address,
    city,
    province,
    postal,
    patientStatus: "AC",
    activeCount: "1",
  };
  if (email) demographicPayload.email = email;

  const result = await oscarPost(
    `${restBase}/demographics`,
    demographicPayload,
    creds
  );

  if (!result.ok) {
    console.error(
      `[create-oscar-patient] Oscar patient creation failed for clinic ${clinicSlug}: status=${result.status}`
    );
    return NextResponse.json(
      { error: "Failed to create patient record in the clinic's system. Please contact the clinic." },
      { status: 502 }
    );
  }

  const demographicNo = extractDemographicNo(result.json);
  if (!demographicNo) {
    console.error(
      `[create-oscar-patient] Oscar response did not include demographicNo for clinic ${clinicSlug}`
    );
    return NextResponse.json(
      { error: "Patient record was created but could not be confirmed. Please contact the clinic." },
      { status: 502 }
    );
  }

  return NextResponse.json({ demographicNo });

  } catch (err) {
    console.error("[create-oscar-patient] Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please contact the clinic." },
      { status: 500 }
    );
  }
}
