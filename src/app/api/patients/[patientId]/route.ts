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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  return null;
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ patientId: string }> },
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

    const { patientId } = await ctx.params;
    const id = String(patientId || "").trim();
    if (!id) {
      status = 400;
      const res = badRequest("patientId is required.", status);
      logRequestMeta("/api/patients/[patientId]", requestId, status, Date.now() - started);
      return res;
    }
    if (!isUuid(id)) {
      status = 400;
      const res = badRequest("patientId must be a UUID.", status);
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
          (
            $2::uuid IS NOT NULL
            AND (
              organization_id = $2::uuid
              OR (organization_id IS NULL AND primary_physician_id = $3::uuid)
            )
          )
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
      encounter_type: string | null;
      current_soap_version_id: string | null;
      soap_subjective: string | null;
      soap_objective: string | null;
      soap_assessment: string | null;
      soap_plan: string | null;
      soap_lifecycle_state: string | null;
      soap_version: number | null;
      soap_finalized_for_export_at: Date | null;
      physician_id: string | null;
      created_at: Date;
    }>(
      `
      SELECT
        pe.id,
        pe.occurred_at,
        pe.source_session_code,
        pe.chief_complaint,
        pe.hpi_json,
        pe.encounter_type,
        pe.current_soap_version_id,
        snv.subjective AS soap_subjective,
        snv.objective AS soap_objective,
        snv.assessment AS soap_assessment,
        snv.plan AS soap_plan,
        snv.lifecycle_state AS soap_lifecycle_state,
        snv.version AS soap_version,
        snv.finalized_for_export_at AS soap_finalized_for_export_at,
        pe.physician_id,
        pe.created_at
      FROM patient_encounters pe
      LEFT JOIN soap_note_versions snv ON snv.id = pe.current_soap_version_id
      WHERE pe.patient_id = $1
      ORDER BY pe.occurred_at DESC
      `,
      [id],
    );

    const sessionCodes = Array.from(
      new Set(
        encRes.rows
          .map((row) => (typeof row.source_session_code === "string" ? row.source_session_code.trim() : ""))
          .filter((value) => value.length > 0),
      ),
    );

    const labRes =
      sessionCodes.length > 0
        ? await query<{
            id: string;
            session_code: string;
            patient_name: string;
            patient_email: string;
            physician_name: string | null;
            clinic_name: string | null;
            clinic_address: string | null;
            labs: any;
            additional_instructions: string | null;
            created_at: Date;
          }>(
            `
            SELECT id, session_code, patient_name, patient_email,
                   physician_name, clinic_name, clinic_address,
                   labs, additional_instructions, created_at
            FROM lab_requisitions
            WHERE session_code = ANY($1::text[])
            ORDER BY created_at DESC
            `,
            [sessionCodes],
          )
        : { rows: [] };

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
        createdAt: toIso(patient.created_at),
        updatedAt: toIso(patient.updated_at),
      },
      encounters: encRes.rows.map((e) => ({
        id: e.id,
        occurredAt: toIso(e.occurred_at),
        physicianId: e.physician_id,
        sourceSessionCode: e.source_session_code,
        chiefComplaint: e.chief_complaint,
        encounterType: e.encounter_type || "guided_interview",
        soapVersionId: e.current_soap_version_id,
        hpi:
          e.current_soap_version_id && e.soap_subjective != null
            ? {
                summary: e.soap_subjective || "",
                physicalFindings: e.soap_objective
                  ? [e.soap_objective]
                  : [],
                assessment: e.soap_assessment || "",
                plan: e.soap_plan
                  ? String(e.soap_plan)
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : [],
                soapLifecycleState: e.soap_lifecycle_state || null,
                soapVersion: e.soap_version || null,
                finalizedForExportAt: toIso(e.soap_finalized_for_export_at),
              }
            : e.hpi_json,
        createdAt: toIso(e.created_at),
      })),
      labRequisitions: labRes.rows.map((row) => ({
        id: row.id,
        sessionCode: row.session_code,
        patientName: row.patient_name,
        patientEmail: row.patient_email,
        physicianName: row.physician_name,
        clinicName: row.clinic_name,
        clinicAddress: row.clinic_address,
        labs: row.labs,
        instructions: row.additional_instructions,
        createdAt: toIso(row.created_at),
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

