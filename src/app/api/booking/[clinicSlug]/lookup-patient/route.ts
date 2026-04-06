/**
 * POST /api/booking/[clinicSlug]/lookup-patient
 * Public route — searches Oscar EMR for a patient by name + DOB.
 *
 * Security controls:
 *  - Requires an active booking hold cookie (same slot-hold mechanism as confirm).
 *    This prevents unauthenticated enumeration of Oscar patient records.
 *  - Returns minimal PHI: only a demographicNo on match (no Oscar-stored name/DOB echoed back).
 *  - Oscar errors are not forwarded to the client.
 *  - All inputs are validated before touching Oscar.
 *
 * Body: { firstName, lastName, dateOfBirth, email? }
 *
 * Response variants:
 *   { oscarConnected: false }
 *   { oscarConnected: true, found: false }
 *   { oscarConnected: true, found: true, demographicNo: string }
 *   { oscarConnected: true, ambiguous: true, clinicEmail: string | null }
 *   { oscarConnected: true, lookupError: true, clinicEmail: string | null }
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
// Limit name length to prevent oversized queries reaching Oscar
const MAX_NAME_LEN = 100;

// ---------------------------------------------------------------------------
// Oscar search utilities (mirrors logic in /api/emr/oscar/patient-lookup)
// ---------------------------------------------------------------------------

function normalizeDob(dob: string): string | null {
  const cleaned = dob.trim();
  return DOB_RE.test(cleaned) ? cleaned : null;
}

function pickArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const obj = value as any;
    for (const key of ["results", "demographics", "items", "data"]) {
      if (Array.isArray(obj[key])) return obj[key];
    }
  }
  return [];
}

function tryPickArrayDeep(value: unknown): any[] {
  if (!value || typeof value !== "object") return [];
  const obj = value as any;
  if (Array.isArray(obj.content)) return obj.content;
  if (obj.content && typeof obj.content === "object") {
    const inner = obj.content as any;
    if (Array.isArray(inner)) return inner;
    if (Array.isArray(inner.Item)) return inner.Item;
    if (inner.Item && typeof inner.Item === "object") return [inner.Item];
    const arr = pickArray(inner);
    if (arr.length > 0) return arr;
  }
  if (obj.List && typeof obj.List === "object") {
    const list = obj.List as any;
    if (Array.isArray(list.Item)) return list.Item;
    if (list.Item && typeof list.Item === "object") return [list.Item];
  }
  if (Array.isArray(obj.Item)) return obj.Item;
  if (obj.Item && typeof obj.Item === "object") return [obj.Item];
  return pickArray(value);
}

function normalizeMatch(item: any): { demographicNo: string; dateOfBirth?: string } | null {
  const demographicNo = String(
    item?.demographicNo ?? item?.demographic_no ?? item?.demographicNumber ?? item?.id ?? item?.dataId ?? ""
  ).trim();
  if (!demographicNo) return null;
  const dobRaw = String(
    item?.dob ?? item?.dateOfBirth ?? item?.birthDate ?? item?.birth_date ?? item?.dateOfBirthStr ?? ""
  ).trim();
  return { demographicNo, dateOfBirth: normalizeDob(dobRaw) ?? undefined };
}

type OscarCreds = {
  client_key: string;
  clientSecret: string;
  accessToken: string;
  tokenSecret: string;
  restBase: string;
};

async function oscarGet(
  url: string,
  creds: OscarCreds
): Promise<{ ok: true; json: unknown } | { ok: false; status: number }> {
  const signed = signOAuth1Request({
    method: "GET",
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
        method: "GET",
        headers: {
          ...(useHeader ? { Authorization: signed.authorizationHeader } : {}),
          Accept: "application/json",
        },
      });
    } catch {
      return null; // network/DNS error
    }
  };

  const res1 = await doFetch(true);
  if (!res1) return { ok: false, status: 503 }; // network error
  let res = res1;
  if (!res.ok && res.status === 401) {
    const res2 = await doFetch(false);
    if (!res2) return { ok: false, status: 503 };
    res = res2;
  }
  if (!res.ok) return { ok: false, status: res.status };
  try {
    return { ok: true, json: await res.json() };
  } catch {
    return { ok: false, status: 502 };
  }
}

async function fetchDobForDemographic(demographicNo: string, creds: OscarCreds): Promise<string | null> {
  // Try lightweight summary endpoint first, fall back to full record
  const summaryRes = await oscarGet(
    `${creds.restBase}/demographics/summary/${encodeURIComponent(demographicNo)}`,
    creds
  );
  if (summaryRes.ok) {
    const obj = summaryRes.json as any;
    const dob = normalizeDob(String(obj?.dob ?? obj?.dateOfBirth ?? obj?.birthDate ?? "").trim() || "");
    if (dob) return dob;
  }
  const fullRes = await oscarGet(
    `${creds.restBase}/demographics/${encodeURIComponent(demographicNo)}`,
    creds
  );
  if (!fullRes.ok) return null;
  const obj = fullRes.json as any;
  return normalizeDob(
    String(obj?.dob ?? obj?.dateOfBirth ?? obj?.birthDate ?? obj?.dateOfBirthStr ?? "").trim() || ""
  );
}

async function fetchEmailForDemographic(demographicNo: string, creds: OscarCreds): Promise<string | null> {
  const res = await oscarGet(
    `${creds.restBase}/demographics/${encodeURIComponent(demographicNo)}`,
    creds
  );
  if (!res.ok) return null;
  const obj = res.json as any;
  const contact = obj?.contact;
  const emails = obj?.emails;
  const raw =
    obj?.email ||
    obj?.emailAddress ||
    obj?.email_address ||
    obj?.eMail ||
    (contact && typeof contact === "object" ? contact.email : null) ||
    (emails && typeof emails === "object" ? emails.primary ?? emails.email : null) ||
    null;
  return typeof raw === "string" ? raw.trim().toLowerCase() || null : null;
}

function buildSearchQueries(firstName: string, lastName: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ");
    if (t && !out.includes(t)) out.push(t);
  };
  push(`${firstName} ${lastName}`);
  push(`${lastName} ${firstName}`);
  push(`${lastName}, ${firstName}`);
  push(lastName);
  return out;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> }
) {
  try {
  const { clinicSlug } = await params;

  // Security: require an active hold cookie — proves the caller has a real slot hold
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

  const firstName = String(body.firstName ?? "").trim().slice(0, MAX_NAME_LEN);
  const lastName = String(body.lastName ?? "").trim().slice(0, MAX_NAME_LEN);
  const dateOfBirth = String(body.dateOfBirth ?? "").trim();
  const emailRaw = String(body.email ?? "").trim();

  if (!firstName || !lastName || !normalizeDob(dateOfBirth)) {
    return NextResponse.json(
      { error: "firstName, lastName, and dateOfBirth (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }

  // Validate email format if provided
  const email =
    emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)
      ? emailRaw.toLowerCase()
      : null;

  // Resolve clinic
  const clinic = await getClinicBySlug(clinicSlug);
  if (!clinic || !clinic.settings?.onlineBookingEnabled) {
    return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
  }

  // Verify the hold cookie actually belongs to a live hold for this clinic
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

  // Fetch clinic email for ambiguous/error responses
  const orgRow = await query<{ email: string | null }>(
    "SELECT email FROM organizations WHERE id = $1 LIMIT 1",
    [clinic.id]
  );
  const clinicEmail = orgRow.rows[0]?.email ?? null;

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
    return NextResponse.json({ oscarConnected: false });
  }

  const conn = connRes.rows[0]!;
  const creds: OscarCreds = {
    client_key: conn.client_key,
    clientSecret: decryptString(conn.client_secret_enc),
    accessToken: decryptString(conn.access_token_enc!),
    tokenSecret: decryptString(conn.token_secret_enc!),
    restBase: getOscarRestBase(conn.base_url),
  };

  // Search Oscar
  const queries = buildSearchQueries(firstName, lastName);
  let searchJson: unknown | null = null;

  for (const q of queries) {
    const url = `${creds.restBase}/demographics/quickSearch?query=${encodeURIComponent(q)}`;
    const res = await oscarGet(url, creds);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        // Auth failure — don't retry, surface as lookup error
        return NextResponse.json({ oscarConnected: true, lookupError: true, clinicEmail });
      }
      continue; // retry with different query on 5xx
    }
    const arr = tryPickArrayDeep(res.json);
    if (arr.length > 0) { searchJson = res.json; break; }
    if (!searchJson) searchJson = res.json; // keep first OK even if empty
  }

  if (searchJson === null) {
    // All queries failed — Oscar unreachable
    return NextResponse.json({ oscarConnected: true, lookupError: true, clinicEmail });
  }

  const candidates = tryPickArrayDeep(searchJson)
    .map(normalizeMatch)
    .filter(Boolean) as NonNullable<ReturnType<typeof normalizeMatch>>[];

  // Filter by DOB (fetch if not included in quick search result)
  const capped = candidates.slice(0, 15);
  const dobMatched = (
    await Promise.all(
      capped.map(async (c) => {
        const dob = c.dateOfBirth ?? (await fetchDobForDemographic(c.demographicNo, creds));
        return dob === dateOfBirth ? c : null;
      })
    )
  ).filter(Boolean) as typeof capped;

  if (dobMatched.length === 0) {
    return NextResponse.json({ oscarConnected: true, found: false });
  }

  // Narrow by email if provided and multiple DOB matches exist
  let finalMatches = dobMatched;
  if (email && dobMatched.length > 1) {
    const byEmail = (
      await Promise.all(
        dobMatched.map(async (m) => {
          const oscarEmail = await fetchEmailForDemographic(m.demographicNo, creds);
          return oscarEmail === email ? m : null;
        })
      )
    ).filter(Boolean) as typeof dobMatched;
    if (byEmail.length > 0) finalMatches = byEmail;
  }

  if (finalMatches.length === 1) {
    // Return only demographicNo — caller already has the patient's name
    return NextResponse.json({
      oscarConnected: true,
      found: true,
      demographicNo: finalMatches[0]!.demographicNo,
    });
  }

  // Multiple unresolvable matches
  return NextResponse.json({ oscarConnected: true, ambiguous: true, clinicEmail });

  } catch (err) {
    console.error("[lookup-patient] Unhandled error:", err);
    // Return lookupError so the frontend blocks gracefully with clinic contact info
    // We don't have clinicEmail here, so return null — the UI still shows the block message.
    return NextResponse.json(
      { oscarConnected: true, lookupError: true, clinicEmail: null },
      { status: 200 } // intentionally 200 — client logic reads the body, not the status
    );
  }
}
