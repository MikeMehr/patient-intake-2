import type { HistoryResponse } from "@/lib/history-schema";
import type { PatientProfile } from "@/lib/interview-schema";
import { getClient } from "@/lib/db";
import { computeHinHash, encryptPatientPhiString } from "@/lib/patient-phi";
import type { PoolClient } from "pg";

function splitFullName(fullName: string): { firstName: string | null; lastName: string | null } {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: null, lastName: null };
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { firstName: null, lastName: parts[0] || null };
  const lastName = parts[parts.length - 1] || null;
  const firstName = parts.slice(0, -1).join(" ").trim() || null;
  return { firstName, lastName };
}

function normalizeDobToDateString(raw?: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  // Prefer YYYY-MM-DD (HTML date input). If not, store null (avoid guessing).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

type Scope = { organizationId: string; physicianId?: never } | { organizationId?: never; physicianId: string };

async function resolveScopeForPhysician(client: PoolClient, physicianId: string): Promise<Scope> {
  const res = await client.query(
    `SELECT organization_id FROM physicians WHERE id = $1 LIMIT 1`,
    [physicianId],
  );
  const orgId = (res.rows?.[0] as any)?.organization_id ?? null;
  if (orgId) return { organizationId: orgId };
  return { physicianId };
}

function scopeWhere(scope: Scope, startIndex: number): { sql: string; params: any[] } {
  if ("organizationId" in scope) {
    return { sql: `organization_id = $${startIndex}`, params: [scope.organizationId] };
  }
  return { sql: `organization_id IS NULL AND primary_physician_id = $${startIndex}`, params: [scope.physicianId] };
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

export async function upsertPatientFromSession(params: {
  physicianId: string;
  patientName: string;
  patientEmail: string;
  patientProfile: PatientProfile;
  oscarDemographicNo?: string | null;
}): Promise<{ patientId: string; scope: Scope }> {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const scope = await resolveScopeForPhysician(client, params.physicianId);
    const { sql: scopeSql, params: scopeParams } = scopeWhere(scope, 1);

    const fullName = params.patientName.trim();
    const nameParts = splitFullName(fullName);
    const dob = normalizeDobToDateString(params.patientProfile?.dateOfBirth);

    const primaryPhone = nonEmpty(params.patientProfile?.primaryPhone);
    const secondaryPhone = nonEmpty(params.patientProfile?.secondaryPhone);
    const address = nonEmpty(params.patientProfile?.address);

    const hinRaw = nonEmpty(params.patientProfile?.insuranceNumber);

    let hinHash: string | null = null;
    let hinEnc: string | null = null;
    if (hinRaw) {
      // Best-effort in non-prod: if keys are missing, we just don't store the HIN.
      try {
        hinHash = computeHinHash(hinRaw);
      } catch {
        hinHash = null;
      }
      try {
        hinEnc = encryptPatientPhiString(hinRaw);
      } catch {
        hinEnc = null;
      }
    }

    const oscarDemographicNo = nonEmpty(params.oscarDemographicNo || "");

    const findPatientId = async (): Promise<string | null> => {
      if (oscarDemographicNo) {
        const res = await client.query(
          `SELECT id FROM patients
           WHERE ${scopeSql} AND oscar_demographic_no = $${scopeParams.length + 1}
           LIMIT 1`,
          [...scopeParams, oscarDemographicNo],
        );
        const id = (res.rows?.[0] as any)?.id;
        if (typeof id === "string" && id) return id;
      }

      if (hinHash) {
        const res = await client.query(
          `SELECT id FROM patients
           WHERE ${scopeSql} AND hin_hash = $${scopeParams.length + 1}
           LIMIT 1`,
          [...scopeParams, hinHash],
        );
        const id = (res.rows?.[0] as any)?.id;
        if (typeof id === "string" && id) return id;
      }

      if (fullName && dob) {
        const res = await client.query(
          `SELECT id FROM patients
           WHERE ${scopeSql}
             AND lower(full_name) = lower($${scopeParams.length + 1})
             AND date_of_birth = $${scopeParams.length + 2}::date
           LIMIT 1`,
          [...scopeParams, fullName, dob],
        );
        const id = (res.rows?.[0] as any)?.id;
        if (typeof id === "string" && id) return id;
      }

      return null;
    };

    const existingId = await findPatientId();

    if (existingId) {
      await client.query(
        `UPDATE patients
         SET
           oscar_demographic_no = COALESCE($1, oscar_demographic_no),
           first_name = COALESCE($2, first_name),
           last_name = COALESCE($3, last_name),
           full_name = $4,
           date_of_birth = COALESCE($5::date, date_of_birth),
           email = COALESCE($6, email),
           primary_phone = COALESCE($7, primary_phone),
           secondary_phone = COALESCE($8, secondary_phone),
           address = COALESCE($9, address),
           hin_enc = COALESCE($10, hin_enc),
           hin_hash = COALESCE($11, hin_hash)
         WHERE id = $12`,
        [
          oscarDemographicNo,
          nameParts.firstName,
          nameParts.lastName,
          fullName,
          dob,
          params.patientEmail?.toLowerCase?.() ? params.patientEmail.toLowerCase() : params.patientEmail,
          primaryPhone,
          secondaryPhone,
          address,
          hinEnc,
          hinHash,
          existingId,
        ],
      );

      await client.query("COMMIT");
      return { patientId: existingId, scope };
    }

    const insertRes = await client.query(
      `INSERT INTO patients (
         organization_id,
         primary_physician_id,
         oscar_demographic_no,
         first_name,
         last_name,
         full_name,
         date_of_birth,
         email,
         primary_phone,
         secondary_phone,
         address,
         hin_enc,
         hin_hash
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13
       )
       RETURNING id`,
      [
        "organizationId" in scope ? scope.organizationId : null,
        params.physicianId,
        oscarDemographicNo,
        nameParts.firstName,
        nameParts.lastName,
        fullName,
        dob,
        params.patientEmail?.toLowerCase?.() ? params.patientEmail.toLowerCase() : params.patientEmail,
        primaryPhone,
        secondaryPhone,
        address,
        hinEnc,
        hinHash,
      ],
    );

    const patientId = (insertRes.rows?.[0] as any)?.id;
    if (typeof patientId !== "string" || !patientId) throw new Error("Failed to insert patient");

    await client.query("COMMIT");
    return { patientId, scope };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createEncounterFromSession(params: {
  patientId: string;
  physicianId: string;
  scope: Scope;
  occurredAt: Date;
  sessionCode: string;
  chiefComplaint: string;
  history: HistoryResponse;
}): Promise<{ encounterId: string } | null> {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const organizationId = "organizationId" in params.scope ? params.scope.organizationId : null;

    try {
      const inserted = await client.query(
        `INSERT INTO patient_encounters (
           patient_id,
           organization_id,
           physician_id,
           occurred_at,
           source_session_code,
           chief_complaint,
           hpi_json
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         RETURNING id`,
        [
          params.patientId,
          organizationId,
          params.physicianId,
          params.occurredAt,
          params.sessionCode,
          params.chiefComplaint || null,
          JSON.stringify(params.history || {}),
        ],
      );

      const encounterId = (inserted.rows?.[0] as any)?.id;
      if (typeof encounterId !== "string" || !encounterId) throw new Error("Failed to insert encounter");

      await client.query("COMMIT");
      return { encounterId };
    } catch (err: any) {
      // Unique index on (patient_id, source_session_code) is partial; if it conflicts, treat as already created.
      if (err && err.code === "23505") {
        const existing = await client.query(
          `SELECT id FROM patient_encounters
           WHERE patient_id = $1 AND source_session_code = $2
           LIMIT 1`,
          [params.patientId, params.sessionCode],
        );
        await client.query("COMMIT");
        const encounterId = (existing.rows?.[0] as any)?.id;
        return typeof encounterId === "string" && encounterId ? { encounterId } : null;
      }
      throw err;
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

