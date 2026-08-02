import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getOscarCredsForOrg } from "@/lib/oscar/self-serve";
import { fetchOscarDemographic } from "@/lib/oscar/demographics";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

const ROUTE = "/api/emr/oscar/patient-details";

/**
 * Look up one OSCAR demographic record by demographic number.
 *
 * The OSCAR I/O and field normalization live in src/lib/oscar/demographics.ts
 * so the OSCAR-launch flow can share them; this handler is auth + shaping only.
 *
 * BEHAVIOUR CHANGE (vs. the previous inline implementation): `dateOfBirth` is
 * now normalized to strict YYYY-MM-DD via extractOscarDob. It previously
 * returned OSCAR's raw field, which for builds that send split date components
 * is the day-of-month alone (e.g. "16").
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required" }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    if (session.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required" }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    const orgId = session.organizationId;
    if (!orgId) {
      status = 400;
      const res = NextResponse.json({ error: "Provider organization is missing" }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const body = (await request.json().catch(() => ({}))) as { demographicNo?: string };
    const demographicNo = String(body.demographicNo || "").trim();
    if (!demographicNo) {
      status = 400;
      const res = NextResponse.json({ error: "demographicNo is required" }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const creds = await getOscarCredsForOrg(orgId);
    if (!creds) {
      status = 400;
      const res = NextResponse.json({ error: "OSCAR is not connected for this organization" }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const result = await fetchOscarDemographic(creds, demographicNo);
    if (!result.ok) {
      status = 502;
      const res = NextResponse.json(
        { error: `OSCAR details failed (${result.status})`, details: result.detail },
        { status },
      );
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json(result.demographic);
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[emr/oscar/patient-details] Error", error);
    const res = NextResponse.json({ error: "Failed to fetch patient details from OSCAR" }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }
}
