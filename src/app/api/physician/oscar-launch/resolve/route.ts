import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { resolveAllowedOpenerOrigin } from "@/lib/oscar/launch-origins";
import { getOscarCredsForOrg } from "@/lib/oscar/self-serve";
import { fetchOscarDemographic } from "@/lib/oscar/demographics";
import {
  resolveWorkforceScope,
  upsertPatientFromOscarDemographic,
} from "@/lib/transcription-store";

export const runtime = "nodejs";

const ROUTE = "/api/physician/oscar-launch/resolve";

const requestSchema = z.object({
  demographicNo: z.string().trim().regex(/^[0-9]{1,12}$/, "demographicNo must be a positive integer"),
  openerOrigin: z.string().trim().max(253).optional(),
});

/**
 * Resolve an OSCAR demographic number to a local patient chart, for the
 * "Transcribe" button in the OSCAR eChart.
 *
 * DESIGN NOTE — non-fatal outcomes return 200 with a `status` discriminator
 * rather than 4xx. If OSCAR is unreachable or the patient can't be resolved,
 * the doctor still wants to dictate; the UI degrades to manual patient entry
 * instead of showing a red error over a working transcription page.
 *
 * The response also carries `allowedOpenerOrigin`, which is the ONLY way the
 * browser learns which origin it may post the finished note back to. The URL
 * parameter is advisory; this server-side allow-list is authoritative.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    if (session.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid payload." }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }
    const { demographicNo } = parsed.data;

    // Resolved up front so every branch below can return it.
    const allowedOpenerOrigin = resolveAllowedOpenerOrigin(parsed.data.openerOrigin ?? null);

    const physicianId = getEffectivePhysicianId(session);
    const scope = resolveWorkforceScope({
      userType: session.userType,
      userId: physicianId,
      organizationId: session.organizationId || null,
    });
    if (!scope) {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const finish = async (
      payload: Record<string, unknown>,
      audit?: { patientId: string; matchedBy: string; oscarFetched: boolean },
    ) => {
      if (audit) {
        await logPhysicianPhiAudit({
          physicianId,
          patientId: audit.patientId,
          eventType: "oscar_launch_patient_resolved",
          ipAddress: getRequestIp(request.headers),
          userAgent: request.headers.get("user-agent"),
          // Never name or DOB here — the demographic number is the identifier
          // the audit log is meant to carry.
          metadata: {
            requestId,
            oscarDemographicNo: demographicNo,
            matchedBy: audit.matchedBy,
            oscarFetched: audit.oscarFetched,
          },
        });
      }
      const res = NextResponse.json({ ...payload, allowedOpenerOrigin });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    };

    // ── 1. Local-first lookup ────────────────────────────────────────────
    // A single indexed query, and the only path that works while the clinic
    // LAN (and therefore OSCAR) is unreachable.
    const scopeSql =
      "organizationId" in scope
        ? "p.organization_id = $2"
        : "p.organization_id IS NULL AND p.primary_physician_id = $2";
    const scopeParam = "organizationId" in scope ? scope.organizationId : scope.physicianId;

    const local = await query<{
      id: string;
      full_name: string;
      date_of_birth: string | null;
      email: string | null;
      primary_phone: string | null;
    }>(
      `SELECT p.id, p.full_name, to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
              p.email, p.primary_phone
       FROM patients p
       WHERE p.oscar_demographic_no = $1 AND ${scopeSql}
       LIMIT 1`,
      [demographicNo, scopeParam],
    );

    if (local.rows[0]) {
      const row = local.rows[0];
      return finish(
        {
          status: "resolved",
          matchedBy: "oscar_demographic_no",
          patient: {
            id: row.id,
            fullName: row.full_name,
            dateOfBirth: row.date_of_birth,
            email: row.email,
            primaryPhone: row.primary_phone,
          },
        },
        { patientId: row.id, matchedBy: "oscar_demographic_no", oscarFetched: false },
      );
    }

    // ── 2. Ask OSCAR ─────────────────────────────────────────────────────
    const orgId = session.organizationId;
    const creds = orgId ? await getOscarCredsForOrg(orgId) : null;
    if (!creds) {
      return finish({ status: "oscar_not_connected" });
    }

    const fetched = await fetchOscarDemographic(creds, demographicNo);
    if (!fetched.ok) {
      // Deliberately collapsed to one client-visible status: from the doctor's
      // point of view the patient could not be loaded either way. The detail is
      // logged server-side for triage.
      console.error(
        `[oscar-launch/resolve] demographic ${demographicNo} unavailable (${fetched.reason}/${fetched.status})`,
        { requestId },
      );
      return finish({ status: "not_found_in_oscar" });
    }

    const demographic = fetched.demographic;
    const fullName = [demographic.firstName, demographic.lastName].filter(Boolean).join(" ").trim();
    if (!fullName) {
      console.error(`[oscar-launch/resolve] demographic ${demographicNo} has no name`, { requestId });
      return finish({ status: "not_found_in_oscar" });
    }

    // ── 3. Find-or-create the local chart ────────────────────────────────
    const upserted = await upsertPatientFromOscarDemographic({
      physicianId,
      scope,
      oscarDemographicNo: demographicNo,
      fullName,
      firstName: demographic.firstName,
      lastName: demographic.lastName,
      dateOfBirth: demographic.dateOfBirth,
      email: demographic.patientEmail,
      primaryPhone: demographic.primaryPhone,
    });

    return finish(
      {
        status: "resolved",
        matchedBy: upserted.matchedBy,
        patient: {
          id: upserted.patientId,
          fullName: upserted.patientName,
          dateOfBirth: demographic.dateOfBirth,
          email: demographic.patientEmail,
          primaryPhone: demographic.primaryPhone,
        },
      },
      { patientId: upserted.patientId, matchedBy: upserted.matchedBy, oscarFetched: true },
    );
  } catch (error) {
    status = 500;
    console.error("[oscar-launch/resolve] Error", error);
    const res = NextResponse.json({ error: "Failed to resolve the OSCAR patient." }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }
}
