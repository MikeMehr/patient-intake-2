import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { decryptPatientPhiString, maskHin } from "@/lib/patient-phi";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export const runtime = "nodejs";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function canDecryptHin(): boolean {
  return Boolean(process.env.PATIENT_PHI_ENCRYPTION_KEY);
}

export async function GET(
  request: NextRequest,
  ctx: { params: { patientId: string } },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = badRequest("Authentication required.", status);
      logRequestMeta("/api/patients/[patientId]", requestId, status, Date.now() - started);
      return res;
    }
    if (session.userType !== "provider") {
      status = 403;
      const res = badRequest("Provider access required.", status);
      logRequestMeta("/api/patients/[patientId]", requestId, status, Date.now() - started);
      return res;
    }

    const { patientId } = ctx.params;
    const id = String(patientId || "").trim();
    if (!id) {
      status = 400;
      const res = badRequest("patientId is required.", status);
      logRequestMeta("/api/patients/[patientId]", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = (session as any).physicianId || session.userId;
    const orgId = session.organizationId || null;

    const patientRes = await query<{
      id: string;
      organization_id: string | null;
      primary_physician_id: string | null;
      oscar_demographic_no: string | null;
      first_name: string | null;
      last_name: string | null;
      full_name: string;
      date_of_birth: string | null;
      email: string | null;
      primary_phone: string | null;
      secondary_phone: string | null;
      address: string | null;
      hin_enc: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `
      SELECT id, organization_id, primary_physician_id, oscar_demographic_no,
             first_name, last_name, full_name, date_of_birth, email,
             primary_phone, secondary_phone, address, hin_enc,
             created_at, updated_at
      FROM patients
      WHERE id = $1
        AND (
          ($2::uuid IS NOT NULL AND organization_id = $2::uuid)
          OR
          ($2::uuid IS NULL AND organization_id IS NULL AND primary_physician_id = $3::uuid)
        )
      LIMIT 1
      `,
      [id, orgId, physicianId],
    );

    if (patientRes.rows.length === 0) {
      status = 404;
      const res = badRequest("Patient not found.", status);
      logRequestMeta("/api/patients/[patientId]", requestId, status, Date.now() - started);
      return res;
    }

    const patient = patientRes.rows[0];

    const encRes = await query<{
      id: string;
      occurred_at: Date;
      source_session_code: string | null;
      chief_complaint: string | null;
      hpi_json: any;
      physician_id: string | null;
      created_at: Date;
    }>(
      `
      SELECT id, occurred_at, source_session_code, chief_complaint, hpi_json, physician_id, created_at
      FROM patient_encounters
      WHERE patient_id = $1
      ORDER BY occurred_at DESC
      `,
      [id],
    );

    let hinMasked: string | null = null;
    if (patient.hin_enc && canDecryptHin()) {
      try {
        const hinPlain = decryptPatientPhiString(patient.hin_enc);
        hinMasked = maskHin(hinPlain);
      } catch {
        hinMasked = null;
      }
    }

    const res = NextResponse.json({
      patient: {
        id: patient.id,
        oscarDemographicNo: patient.oscar_demographic_no,
        firstName: patient.first_name,
        lastName: patient.last_name,
        fullName: patient.full_name,
        dateOfBirth: patient.date_of_birth,
        email: patient.email,
        primaryPhone: patient.primary_phone,
        secondaryPhone: patient.secondary_phone,
        address: patient.address,
        hinMasked,
        createdAt: patient.created_at,
        updatedAt: patient.updated_at,
      },
      encounters: encRes.rows.map((e) => ({
        id: e.id,
        occurredAt: e.occurred_at,
        physicianId: e.physician_id,
        sourceSessionCode: e.source_session_code,
        chiefComplaint: e.chief_complaint,
        hpi: e.hpi_json,
        createdAt: e.created_at,
      })),
    });
    logRequestMeta("/api/patients/[patientId]", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[patients/[patientId]] GET failed:", error);
    const res = NextResponse.json({ error: "Failed to load patient chart." }, { status });
    logRequestMeta("/api/patients/[patientId]", requestId, status, Date.now() - started);
    return res;
  }
}

