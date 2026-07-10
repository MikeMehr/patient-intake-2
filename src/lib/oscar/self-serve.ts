/**
 * Shared OSCAR patient lookup + demographic creation, scoped by organization.
 *
 * Extracted from the booking routes so both online booking and the self-serve
 * guided-interview intake can reuse the exact same OSCAR read/write logic
 * without duplicating OAuth1 signing, search heuristics, or payload shapes.
 *
 * These helpers are org-scoped only — callers are responsible for their own
 * authorization/gating (booking uses a slot-hold cookie; interview-intake fuses
 * the lookup into a rate-limited start endpoint).
 */

import { query } from "@/lib/db";
import { decryptString } from "@/lib/encrypted-field";
import { getOscarRestBase, oscarFetch } from "@/lib/oscar/client";
import { signOAuth1Request } from "@/lib/oscar/oauth1";
import { extractOscarDob, normalizeOscarDob } from "@/lib/oscar/dob";

export type OscarCreds = {
  client_key: string;
  clientSecret: string;
  accessToken: string;
  tokenSecret: string;
  restBase: string;
};

const MAX_NAME_LEN = 100;
const MAX_FIELD_LEN = 200;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Load and decrypt OSCAR OAuth1 credentials for an organization.
 * Returns null when no connected OSCAR connection with access tokens exists.
 */
export async function getOscarCredsForOrg(orgId: string): Promise<OscarCreds | null> {
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
    [orgId]
  );

  if (
    connRes.rows.length === 0 ||
    connRes.rows[0]!.status !== "connected" ||
    !connRes.rows[0]!.access_token_enc ||
    !connRes.rows[0]!.token_secret_enc
  ) {
    return null;
  }

  const conn = connRes.rows[0]!;
  return {
    client_key: conn.client_key,
    clientSecret: decryptString(conn.client_secret_enc),
    accessToken: decryptString(conn.access_token_enc!),
    tokenSecret: decryptString(conn.token_secret_enc!),
    restBase: getOscarRestBase(conn.base_url),
  };
}

// ---------------------------------------------------------------------------
// Search / read utilities (mirrors logic in /api/emr/oscar/patient-lookup)
// ---------------------------------------------------------------------------

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
  return { demographicNo, dateOfBirth: extractOscarDob(item) ?? undefined };
}

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
      return await oscarFetch(fetchUrl, {
        method: "GET",
        headers: {
          ...(useHeader ? { Authorization: signed.authorizationHeader } : {}),
          Accept: "application/json",
        },
      });
    } catch (fetchErr) {
      console.error("[oscar/self-serve] oscarGet() threw:", fetchErr);
      return null;
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
  const summaryRes = await oscarGet(
    `${creds.restBase}/demographics/summary/${encodeURIComponent(demographicNo)}`,
    creds
  );
  if (summaryRes.ok) {
    const dob = extractOscarDob(summaryRes.json);
    if (dob) return dob;
  }
  const fullRes = await oscarGet(
    `${creds.restBase}/demographics/${encodeURIComponent(demographicNo)}`,
    creds
  );
  if (!fullRes.ok) return null;
  return extractOscarDob(fullRes.json);
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

export type LookupResult =
  | { oscarConnected: false }
  | { oscarConnected: true; found: false }
  | { oscarConnected: true; found: true; demographicNo: string }
  | { oscarConnected: true; ambiguous: true }
  | { oscarConnected: true; lookupError: true };

/**
 * Search OSCAR for a single patient matching name + DOB (narrowed by email when
 * multiple DOB matches exist). Never echoes OSCAR-stored PHI — only a
 * demographicNo on an unambiguous match.
 */
export async function lookupOscarPatient(
  orgId: string,
  input: { firstName: string; lastName: string; dateOfBirth: string; email?: string | null }
): Promise<LookupResult> {
  const firstName = String(input.firstName ?? "").trim().slice(0, MAX_NAME_LEN);
  const lastName = String(input.lastName ?? "").trim().slice(0, MAX_NAME_LEN);
  const dateOfBirth = normalizeOscarDob(String(input.dateOfBirth ?? "").trim());
  const emailRaw = String(input.email ?? "").trim();
  const email =
    emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw.toLowerCase() : null;

  if (!firstName || !lastName || !dateOfBirth) {
    // Caller should validate; treat as no match rather than throwing.
    return { oscarConnected: true, found: false };
  }

  const creds = await getOscarCredsForOrg(orgId);
  if (!creds) return { oscarConnected: false };

  const queries = buildSearchQueries(firstName, lastName);
  let searchJson: unknown | null = null;

  for (const q of queries) {
    const url = `${creds.restBase}/demographics/quickSearch?query=${encodeURIComponent(q)}`;
    const res = await oscarGet(url, creds);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { oscarConnected: true, lookupError: true };
      }
      continue; // retry with different query on 5xx
    }
    const arr = tryPickArrayDeep(res.json);
    if (arr.length > 0) {
      searchJson = res.json;
      break;
    }
    if (!searchJson) searchJson = res.json; // keep first OK even if empty
  }

  if (searchJson === null) {
    return { oscarConnected: true, lookupError: true };
  }

  const candidates = tryPickArrayDeep(searchJson)
    .map(normalizeMatch)
    .filter(Boolean) as NonNullable<ReturnType<typeof normalizeMatch>>[];

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
    return { oscarConnected: true, found: false };
  }

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
    return { oscarConnected: true, found: true, demographicNo: finalMatches[0]!.demographicNo };
  }

  return { oscarConnected: true, ambiguous: true };
}

// ---------------------------------------------------------------------------
// Demographic creation
// ---------------------------------------------------------------------------

function truncate(val: unknown, max = MAX_FIELD_LEN): string {
  return String(val ?? "").trim().slice(0, max);
}

async function oscarPost(
  url: string,
  body: Record<string, unknown>,
  creds: OscarCreds
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
      return await oscarFetch(fetchUrl, {
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
  const target = obj.content ?? obj.demographic ?? obj;
  const no = String(
    target?.demographicNo ?? target?.demographic_no ?? target?.demographicNumber ?? target?.id ?? ""
  ).trim();
  return no || null;
}

export type CreateDemographicInput = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postal: string;
  email?: string | null;
  gender?: string | null;
};

export type CreateDemographicResult =
  | { demographicNo: string }
  | { error: string; status: number };

/**
 * Create a new demographic record in OSCAR. Validates inputs, returns only the
 * new demographicNo (no OSCAR PHI echoed back) or a structured error.
 */
export async function createOscarDemographic(
  orgId: string,
  input: CreateDemographicInput
): Promise<CreateDemographicResult> {
  const firstName = truncate(input.firstName);
  const lastName = truncate(input.lastName);
  const dateOfBirth = truncate(input.dateOfBirth, 10);
  const phone = truncate(input.phone, 30);
  const address = truncate(input.address);
  const city = truncate(input.city, 100);
  const province = truncate(input.province, 50);
  const postal = truncate(input.postal, 10);
  const email = truncate(input.email);
  const genderRaw = truncate(input.gender, 1).toUpperCase();
  const sex = ["M", "F", "O", "U"].includes(genderRaw) ? genderRaw : "U";

  if (!firstName || !lastName) {
    return { error: "firstName and lastName are required", status: 400 };
  }
  if (!DOB_RE.test(dateOfBirth)) {
    return { error: "dateOfBirth must be YYYY-MM-DD", status: 400 };
  }
  if (!phone || !address || !city || !province || !postal) {
    return { error: "phone, address, city, province, and postal are required", status: 400 };
  }

  const creds = await getOscarCredsForOrg(orgId);
  if (!creds) {
    return { error: "Oscar EMR is not connected for this clinic", status: 503 };
  }

  const [dobYear, dobMonth, dobDay] = dateOfBirth.split("-");
  const demographicPayload: Record<string, unknown> = {
    firstName,
    lastName,
    dateOfBirth, // OSCAR deserialises YYYY-MM-DD into java.util.Date
    dobYear,
    dobMonth,
    dobDay,
    sex,
    phone,
    address: { address, city, province, postal },
    patientStatus: "AC",
  };
  if (email) demographicPayload.email = email;

  const result = await oscarPost(`${creds.restBase}/demographics`, demographicPayload, creds);

  if (!result.ok) {
    console.error(`[oscar/self-serve] Oscar patient creation failed for org ${orgId}: status=${result.status}`);
    return {
      error: "Failed to create patient record in the clinic's system. Please contact the clinic.",
      status: 502,
    };
  }

  const demographicNo = extractDemographicNo(result.json);
  if (!demographicNo) {
    console.error(`[oscar/self-serve] Oscar response did not include demographicNo for org ${orgId}`);
    return {
      error: "Patient record was created but could not be confirmed. Please contact the clinic.",
      status: 502,
    };
  }

  return { demographicNo };
}
