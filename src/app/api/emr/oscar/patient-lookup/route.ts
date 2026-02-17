import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { decryptString } from "@/lib/encrypted-field";
import { getOscarRestBase } from "@/lib/oscar/client";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { signOAuth1Request } from "@/lib/oscar/oauth1";

export const runtime = "nodejs";
const HANDLER_VERSION = "2026-02-17-quicksearch-v3";

function splitName(input: string): { firstName: string; lastName: string } | null {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (trimmed.includes(",")) {
    const [last, first] = trimmed.split(",").map((s) => s.trim());
    if (!last) return null;
    return { firstName: first || "", lastName: last };
  }
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  const lastName = parts[parts.length - 1]!;
  const firstName = parts.slice(0, -1).join(" ");
  return { firstName, lastName };
}

function normalizeDob(dob: string): string | null {
  const cleaned = dob.trim();
  if (!cleaned) return null;
  // Expect YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return null;
  return cleaned;
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

  // Some OSCAR deployments wrap results in a "content" field:
  // { offset, limit, total, timestamp, content: [...], query }
  if (Array.isArray(obj.content)) return obj.content;
  if (obj.content && typeof obj.content === "object") {
    const inner = obj.content as any;
    if (Array.isArray(inner)) return inner;
    if (Array.isArray(inner.Item)) return inner.Item;
    if (inner.Item && typeof inner.Item === "object") return [inner.Item];
    if (Array.isArray(inner.item)) return inner.item;
    if (inner.item && typeof inner.item === "object") return [inner.item];
    // Fall back to common result keys inside content
    const arr = pickArray(inner);
    if (arr.length > 0) return arr;
  }

  // Some OSCAR responses look like: { List: { Item: [...] } }
  if (obj.List && typeof obj.List === "object") {
    const list = obj.List as any;
    if (Array.isArray(list.Item)) return list.Item;
    if (list.Item && typeof list.Item === "object") return [list.Item];
    if (Array.isArray(list.item)) return list.item;
    if (list.item && typeof list.item === "object") return [list.item];
  }

  // Some might return { Item: [...] } directly.
  if (Array.isArray(obj.Item)) return obj.Item;
  if (obj.Item && typeof obj.Item === "object") return [obj.Item];
  if (Array.isArray(obj.item)) return obj.item;
  if (obj.item && typeof obj.item === "object") return [obj.item];

  return pickArray(value);
}

function safeJsonParse(rawText: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(rawText) };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

function normalizeToMatch(item: any): {
  demographicNo: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  displayName: string;
} | null {
  const demographicNo = String(item?.demographicNo ?? item?.demographic_no ?? item?.demographicNumber ?? item?.id ?? item?.dataId ?? "")
    .trim();
  if (!demographicNo) return null;

  const firstName = String(item?.firstName ?? item?.first_name ?? item?.givenName ?? item?.given_name ?? item?.fname ?? "").trim();
  const lastName = String(item?.lastName ?? item?.last_name ?? item?.surname ?? item?.familyName ?? item?.family_name ?? item?.lname ?? "").trim();
  const dateOfBirthRaw = String(item?.dob ?? item?.dateOfBirth ?? item?.birthDate ?? item?.birth_date ?? item?.dateOfBirthStr ?? "").trim();
  const dateOfBirth = normalizeDob(dateOfBirthRaw || "") ?? undefined;

  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || `${lastName}`.trim() || `Demographic #${demographicNo}`;
  return { demographicNo, firstName, lastName, dateOfBirth, displayName };
}

async function oscarGetJson(args: {
  url: string;
  clientKey: string;
  clientSecret: string;
  accessToken: string;
  tokenSecret: string;
}): Promise<
  | { ok: true; url: string; json: unknown; contentType: string | null }
  | { ok: false; url: string; status: number; text: string; contentType: string | null }
> {
  const signedReq = signOAuth1Request({
    method: "GET",
    url: args.url,
    consumerKey: args.clientKey,
    consumerSecret: args.clientSecret,
    token: args.accessToken,
    tokenSecret: args.tokenSecret,
  });

  const res = await fetch(signedReq.signedUrl, {
    method: "GET",
    headers: {
      Authorization: signedReq.authorizationHeader,
      Accept: "application/json",
    },
  });
  const rawText = await res.text();
  const contentType = res.headers.get("content-type");
  if (!res.ok) return { ok: false, url: args.url, status: res.status, text: rawText, contentType };

  const parsed = safeJsonParse(rawText);
  if (!parsed.ok) return { ok: false, url: args.url, status: 502, text: rawText, contentType };
  return { ok: true, url: args.url, json: parsed.value, contentType };
}

async function fetchDobForDemographicNo(args: {
  restBase: string;
  demographicNo: string;
  clientKey: string;
  clientSecret: string;
  accessToken: string;
  tokenSecret: string;
}): Promise<string | null> {
  // Prefer summary endpoint if available (smaller payload); fall back to full demographic record.
  const summaryUrl = `${args.restBase}/demographics/summary/${encodeURIComponent(args.demographicNo)}`;
  const summaryRes = await oscarGetJson({
    url: summaryUrl,
    clientKey: args.clientKey,
    clientSecret: args.clientSecret,
    accessToken: args.accessToken,
    tokenSecret: args.tokenSecret,
  });
  if (summaryRes.ok) {
    const obj = summaryRes.json as any;
    const dob = normalizeDob(String(obj?.dob ?? obj?.dateOfBirth ?? obj?.birthDate ?? "").trim() || "");
    if (dob) return dob;
  }

  const fullUrl = `${args.restBase}/demographics/${encodeURIComponent(args.demographicNo)}`;
  const fullRes = await oscarGetJson({
    url: fullUrl,
    clientKey: args.clientKey,
    clientSecret: args.clientSecret,
    accessToken: args.accessToken,
    tokenSecret: args.tokenSecret,
  });
  if (!fullRes.ok) return null;
  const obj = fullRes.json as any;
  const dob = normalizeDob(String(obj?.dob ?? obj?.dateOfBirth ?? obj?.birthDate ?? obj?.dateOfBirthStr ?? "").trim() || "");
  return dob;
}

function buildQuickSearchQueries(args: {
  rawPatientName: string;
  firstName: string;
  lastName: string;
}): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const trimmed = s.trim().replace(/\s+/g, " ");
    if (!trimmed) return;
    if (!out.includes(trimmed)) out.push(trimmed);
  };

  // Try what the user typed first.
  push(args.rawPatientName);
  // Common formats OSCAR users might expect.
  push([args.lastName, args.firstName].filter(Boolean).join(" ").trim());
  push([args.firstName, args.lastName].filter(Boolean).join(" ").trim());
  push([args.lastName, args.firstName].filter(Boolean).join(", ").trim());
  // Least specific: last name only (often avoids server-side parsing bugs).
  push(args.lastName);

  return out;
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
      logRequestMeta("/api/emr/oscar/patient-lookup", requestId, status, Date.now() - started);
      return res;
    }
    if (session.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required" }, { status });
      logRequestMeta("/api/emr/oscar/patient-lookup", requestId, status, Date.now() - started);
      return res;
    }
    const orgId = session.organizationId;
    if (!orgId) {
      status = 400;
      const res = NextResponse.json({ error: "Provider organization is missing" }, { status });
      logRequestMeta("/api/emr/oscar/patient-lookup", requestId, status, Date.now() - started);
      return res;
    }

    const body = (await request.json()) as { patientName?: string; patientDob?: string };
    const rawPatientName = String(body.patientName ?? "").trim();
    const parsedName = splitName(rawPatientName);
    const dob = normalizeDob(body.patientDob || "");
    if (!parsedName || !dob) {
      status = 400;
      const res = NextResponse.json({ error: "patientName and patientDob (YYYY-MM-DD) are required" }, { status });
      logRequestMeta("/api/emr/oscar/patient-lookup", requestId, status, Date.now() - started);
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
      logRequestMeta("/api/emr/oscar/patient-lookup", requestId, status, Date.now() - started);
      return res;
    }
    const conn = connRes.rows[0];
    if (conn.status !== "connected" || !conn.access_token_enc || !conn.token_secret_enc) {
      status = 400;
      const res = NextResponse.json({ error: "OSCAR is not connected for this organization" }, { status });
      logRequestMeta("/api/emr/oscar/patient-lookup", requestId, status, Date.now() - started);
      return res;
    }

    const clientSecret = decryptString(conn.client_secret_enc);
    const accessToken = decryptString(conn.access_token_enc);
    const tokenSecret = decryptString(conn.token_secret_enc);
    const restBase = getOscarRestBase(conn.base_url);

    // OSCAR: /demographics/search exists, but some deployments throw 500 for unknown JSON shapes.
    // WADL shows a simpler endpoint: GET /demographics/quickSearch?query=... which is much more
    // compatible. We'll quickSearch by name, then confirm/filter by DOB by fetching details.
    const quickQueries = buildQuickSearchQueries({
      rawPatientName,
      firstName: parsedName.firstName,
      lastName: parsedName.lastName,
    });

    let quickOk: { ok: true; url: string; json: unknown; contentType: string | null } | null = null;
    let firstOk: { ok: true; url: string; json: unknown; contentType: string | null } | null = null;
    let lastErr:
      | { ok: false; url: string; status: number; text: string; contentType: string | null }
      | null = null;
    let usedQuery = "";

    for (const q of quickQueries) {
      const url = `${restBase}/demographics/quickSearch?query=${encodeURIComponent(q)}`;
      const res = await oscarGetJson({
        url,
        clientKey: conn.client_key,
        clientSecret,
        accessToken,
        tokenSecret,
      });
      if (res.ok) {
        // Keep going if this query returns no matches; some OSCAR deployments
        // are picky about query formatting (full name vs last name only).
        if (!firstOk) firstOk = res;
        const arr = tryPickArrayDeep(res.json);
        if (arr.length > 0) {
          quickOk = res;
          usedQuery = q;
          break;
        }
        continue;
      }
      lastErr = res;
      // Retry on 500 with a different query; bail early on auth issues.
      if (res.status === 401 || res.status === 403) break;
    }

    // If every query returned 200 with an empty list, use the first OK response
    // so we can return matches: [] (not a 502).
    if (!quickOk && firstOk) {
      quickOk = firstOk;
      usedQuery = quickQueries[0] || "";
    }

    if (!quickOk) {
      status = 502;
      const res = NextResponse.json(
        {
          error: `OSCAR lookup failed (${lastErr?.status ?? 502})`,
          handlerVersion: HANDLER_VERSION,
          upstream: {
            endpoint: "demographics/quickSearch",
            url: lastErr?.url,
            contentType: lastErr?.contentType,
          },
          triedQueries: quickQueries,
          details: (lastErr?.text ?? "").slice(0, 2000),
          hint:
            lastErr?.status === 500
              ? "OSCAR returned 500. Try searching with only last name (no commas) or verify the OSCAR quickSearch service is enabled."
              : undefined,
        },
        { status },
      );
      logRequestMeta("/api/emr/oscar/patient-lookup", requestId, status, Date.now() - started);
      return res;
    }

    const arr = tryPickArrayDeep(quickOk.json);
    const candidates = arr.map(normalizeToMatch).filter(Boolean) as Array<{
      demographicNo: string;
      firstName: string;
      lastName: string;
      dateOfBirth?: string;
      displayName: string;
    }>;

    // Confirm/filter by DOB. Limit to avoid blasting OSCAR on broad searches.
    const capped = candidates.slice(0, 15);
    const confirmed = await Promise.all(
      capped.map(async (cand) => {
        const candDob =
          cand.dateOfBirth ??
          (await fetchDobForDemographicNo({
            restBase,
            demographicNo: cand.demographicNo,
            clientKey: conn.client_key,
            clientSecret,
            accessToken,
            tokenSecret,
          }));
        if (!candDob) return null;
        if (candDob !== dob) return null;
        return { ...cand, dateOfBirth: candDob };
      }),
    );

    const dobMatched = confirmed.filter(Boolean) as typeof capped;
    const matches = dobMatched.length > 0 ? dobMatched : capped;

    const res = NextResponse.json({
      matches,
      dobFilterApplied: true,
      dobMatchCount: dobMatched.length,
      oscarQuickSearchQueryUsed: usedQuery,
      handlerVersion: HANDLER_VERSION,
      // When matches is empty, this helps us confirm whether OSCAR returned an empty list
      // or we failed to parse a non-empty payload. Avoid returning raw payload (PHI risk).
      debug:
        matches.length === 0
          ? {
              candidateCount: candidates.length,
              quickSearchContentType: quickOk.contentType,
              quickSearchTopLevelKeys:
                quickOk.json && typeof quickOk.json === "object" ? Object.keys(quickOk.json as any).slice(0, 40) : [],
              hasList: Boolean((quickOk.json as any)?.List),
              hasItem: Boolean((quickOk.json as any)?.Item || (quickOk.json as any)?.item),
              hasContent: Boolean((quickOk.json as any)?.content),
              offset: Number.isFinite(Number((quickOk.json as any)?.offset)) ? Number((quickOk.json as any)?.offset) : undefined,
              limit: Number.isFinite(Number((quickOk.json as any)?.limit)) ? Number((quickOk.json as any)?.limit) : undefined,
              total: Number.isFinite(Number((quickOk.json as any)?.total)) ? Number((quickOk.json as any)?.total) : undefined,
            }
          : undefined,
      warning:
        dobMatched.length === 0 && capped.length > 0
          ? "No exact DOB match found; showing name matches from OSCAR quickSearch."
          : undefined,
    });
    logRequestMeta("/api/emr/oscar/patient-lookup", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[emr/oscar/patient-lookup] Error", error);
    const res = NextResponse.json({ error: "Failed to lookup patient in OSCAR" }, { status });
    logRequestMeta("/api/emr/oscar/patient-lookup", requestId, status, Date.now() - started);
    return res;
  }
}

