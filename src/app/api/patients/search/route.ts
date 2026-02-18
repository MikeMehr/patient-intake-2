import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { computeHinHash } from "@/lib/patient-phi";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeDob(dob: string | null | undefined): string | null {
  const t = String(dob || "").trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = badRequest("Authentication required.", status);
      logRequestMeta("/api/patients/search", requestId, status, Date.now() - started);
      return res;
    }
    if (session.userType !== "provider") {
      status = 403;
      const res = badRequest("Provider access required.", status);
      logRequestMeta("/api/patients/search", requestId, status, Date.now() - started);
      return res;
    }

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      dob?: string;
      hin?: string;
      oscarDemographicNo?: string;
      limit?: number;
    };

    const name = String(body?.name || "").trim();
    const dob = normalizeDob(body?.dob);
    const hin = String(body?.hin || "").trim();
    const oscarDemographicNo = String(body?.oscarDemographicNo || "").trim();
    const limit = Math.min(25, Math.max(1, Number(body?.limit || 10)));

    const hasStrongKey = Boolean(oscarDemographicNo) || Boolean(hin);
    const hasNameDob = Boolean(name) && Boolean(dob);
    const hasNameOnly = Boolean(name) && name.length >= 3;
    if (!hasStrongKey && !hasNameDob && !hasNameOnly) {
      status = 400;
      const res = badRequest("Provide oscarDemographicNo, HIN, (name + dob), or name (3+ chars).", status);
      logRequestMeta("/api/patients/search", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = (session as any).physicianId || session.userId;
    const orgId = session.organizationId || null;

    const where: string[] = [];
    const params: any[] = [];

    if (orgId) {
      params.push(orgId);
      where.push(`organization_id = $${params.length}`);
    } else {
      params.push(physicianId);
      where.push(`organization_id IS NULL AND primary_physician_id = $${params.length}`);
    }

    // Pick the strongest identifier available (avoid AND'ing unrelated filters).
    if (oscarDemographicNo) {
      params.push(oscarDemographicNo);
      where.push(`oscar_demographic_no = $${params.length}`);
    } else if (hin) {
      let hinHash: string | null = null;
      try {
        hinHash = computeHinHash(hin);
      } catch {
        hinHash = null;
      }
      if (!hinHash) {
        status = 400;
        const res = badRequest("Unable to search by HIN (hashing not configured).", status);
        logRequestMeta("/api/patients/search", requestId, status, Date.now() - started);
        return res;
      }
      params.push(hinHash);
      where.push(`hin_hash = $${params.length}`);
    } else if (name && dob) {
      params.push(`%${name.toLowerCase()}%`);
      where.push(`lower(full_name) LIKE $${params.length}`);
      params.push(dob);
      where.push(`date_of_birth = $${params.length}::date`);
    } else if (hasNameOnly) {
      params.push(`%${name.toLowerCase()}%`);
      where.push(`lower(full_name) LIKE $${params.length}`);
    }

    const sql = `
      SELECT id, full_name, date_of_birth, email, primary_phone, secondary_phone, oscar_demographic_no
      FROM patients
      WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ${limit}
    `;

    const result = await query<{
      id: string;
      full_name: string;
      date_of_birth: string | null;
      email: string | null;
      primary_phone: string | null;
      secondary_phone: string | null;
      oscar_demographic_no: string | null;
    }>(sql, params);

    const res = NextResponse.json({
      patients: result.rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        dateOfBirth: r.date_of_birth,
        email: r.email,
        primaryPhone: r.primary_phone,
        secondaryPhone: r.secondary_phone,
        oscarDemographicNo: r.oscar_demographic_no,
      })),
    });
    logRequestMeta("/api/patients/search", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[patients/search] POST failed:", error);
    const res = NextResponse.json({ error: "Failed to search patients." }, { status });
    logRequestMeta("/api/patients/search", requestId, status, Date.now() - started);
    return res;
  }
}

