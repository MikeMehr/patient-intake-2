import { createHash } from "crypto";
import { getClient, query } from "@/lib/db";
import type { SoapDraft } from "@/lib/transcription-schema";
import { EMR_EXPORT_STATUS, SOAP_LIFECYCLE_STATES } from "@/lib/transcription-policy";

type Scope = { organizationId: string; physicianId?: never } | { organizationId?: never; physicianId: string };

export function resolveWorkforceScope(params: {
  userType: string;
  userId: string;
  organizationId?: string | null;
}): Scope | null {
  if (params.userType === "org_admin") {
    if (!params.organizationId) return null;
    return { organizationId: params.organizationId };
  }
  if (params.userType === "provider") {
    if (params.organizationId) return { organizationId: params.organizationId };
    return { physicianId: params.userId };
  }
  return null;
}

function scopeWhere(scope: Scope, startIndex: number): { sql: string; params: any[] } {
  if ("organizationId" in scope) {
    return { sql: `p.organization_id = $${startIndex}`, params: [scope.organizationId] };
  }
  return { sql: `p.organization_id IS NULL AND p.primary_physician_id = $${startIndex}`, params: [scope.physicianId] };
}

export async function resolveScopeForPhysician(physicianId: string): Promise<Scope> {
  const res = await query<{ organization_id: string | null }>(
    `SELECT organization_id FROM physicians WHERE id = $1 LIMIT 1`,
    [physicianId],
  );
  const orgId = res.rows?.[0]?.organization_id ?? null;
  if (orgId) return { organizationId: orgId };
  return { physicianId };
}

export async function assertPhysicianCanAccessPatient(params: {
  physicianId: string;
  patientId: string;
  scope: Scope;
}): Promise<{ patientName: string }> {
  const { sql, params: scopeParams } = scopeWhere(params.scope, 2);
  const res = await query<{ full_name: string }>(
    `SELECT p.full_name
     FROM patients p
     WHERE p.id = $1
       AND ${sql}
     LIMIT 1`,
    [params.patientId, ...scopeParams],
  );
  if (res.rowCount === 0) {
    throw new Error("Patient not found or access denied.");
  }
  return { patientName: res.rows[0].full_name };
}

export async function upsertPatientFromQuickEntry(params: {
  physicianId: string;
  scope: Scope;
  fullName: string;
  dateOfBirth: string;
}): Promise<{ patientId: string; patientName: string }> {
  const normalizedFullName = params.fullName.trim().replace(/\s+/g, " ");
  const dob = params.dateOfBirth.trim();
  if (!normalizedFullName || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    throw new Error("Invalid quick-entry patient identity.");
  }
  const { sql, params: scopeParams } = scopeWhere(params.scope, 3);
  const existing = await query<{ id: string; full_name: string }>(
    `SELECT p.id, p.full_name
     FROM patients p
     WHERE lower(p.full_name) = lower($1)
       AND p.date_of_birth = $2::date
       AND ${sql}
     LIMIT 1`,
    [normalizedFullName, dob, ...scopeParams],
  );
  if (existing.rowCount && existing.rows[0]) {
    return { patientId: existing.rows[0].id, patientName: existing.rows[0].full_name };
  }

  const organizationId = "organizationId" in params.scope ? params.scope.organizationId : null;
  const insert = await query<{ id: string; full_name: string }>(
    `INSERT INTO patients (
       organization_id, primary_physician_id, full_name, date_of_birth
     ) VALUES ($1, $2, $3, $4::date)
     RETURNING id, full_name`,
    [organizationId, params.physicianId, normalizedFullName, dob],
  );
  return { patientId: insert.rows[0].id, patientName: insert.rows[0].full_name };
}

export async function createTranscriptionEncounter(params: {
  physicianId: string;
  patientId: string;
  scope: Scope;
  chiefComplaint?: string | null;
}): Promise<{ encounterId: string }> {
  const organizationId = "organizationId" in params.scope ? params.scope.organizationId : null;
  const insert = await query<{ id: string }>(
    `INSERT INTO patient_encounters (
       patient_id, organization_id, physician_id, occurred_at,
       source_session_code, chief_complaint, hpi_json, encounter_type
     ) VALUES ($1,$2,$3,NOW(),NULL,$4,'{}'::jsonb,'transcription')
     RETURNING id`,
    [params.patientId, organizationId, params.physicianId, params.chiefComplaint || null],
  );
  return { encounterId: insert.rows[0].id };
}

export async function createSoapDraftVersion(params: {
  encounterId: string;
  patientId: string;
  physicianId: string;
  draft: SoapDraft;
  transcript: string;
}): Promise<{ soapVersionId: string; version: number }> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const nextVersionRes = await client.query<{ next_version: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM soap_note_versions
       WHERE encounter_id = $1`,
      [params.encounterId],
    );
    const version = nextVersionRes.rows[0].next_version;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO soap_note_versions (
         encounter_id, patient_id, physician_id, version, lifecycle_state,
         subjective, objective, assessment, plan, draft_transcript
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        params.encounterId,
        params.patientId,
        params.physicianId,
        version,
        SOAP_LIFECYCLE_STATES.DRAFT,
        params.draft.subjective,
        params.draft.objective,
        params.draft.assessment,
        params.draft.plan,
        params.transcript,
      ],
    );
    await client.query(
      `UPDATE patient_encounters
       SET current_soap_version_id = $2
       WHERE id = $1`,
      [params.encounterId, inserted.rows[0].id],
    );
    await client.query("COMMIT");
    return { soapVersionId: inserted.rows[0].id, version };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateSoapDraftVersion(params: {
  soapVersionId: string;
  scope: Scope;
  draft: SoapDraft;
}): Promise<void> {
  const { sql: scopeSql, params: scopeParams } = scopeWhere(params.scope, 7);
  const res = await query(
    `UPDATE soap_note_versions
     SET subjective = $3,
         objective = $4,
         assessment = $5,
         plan = $6,
         updated_at = NOW()
     WHERE id = $1
       AND lifecycle_state = $2
       AND EXISTS (
         SELECT 1
         FROM patient_encounters pe
         JOIN patients p ON p.id = pe.patient_id
         WHERE pe.id = soap_note_versions.encounter_id
           AND ${scopeSql}
       )`,
    [
      params.soapVersionId,
      SOAP_LIFECYCLE_STATES.DRAFT,
      params.draft.subjective,
      params.draft.objective,
      params.draft.assessment,
      params.draft.plan,
      ...scopeParams,
    ],
  );
  if ((res.rowCount ?? 0) === 0) {
    throw new Error("Draft not found or already finalized.");
  }
}

export async function finalizeSoapVersion(params: {
  soapVersionId: string;
  scope: Scope;
  actorUserId: string;
}): Promise<{ encounterId: string; patientId: string; version: number }> {
  const { sql: scopeSql, params: scopeParams } = scopeWhere(params.scope, 2);
  const rowRes = await query<{
    id: string;
    encounter_id: string;
    patient_id: string;
    version: number;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    lifecycle_state: string;
  }>(
    `SELECT id, encounter_id, patient_id, version, subjective, objective, assessment, plan, lifecycle_state
     FROM soap_note_versions
     WHERE id = $1
       AND EXISTS (
         SELECT 1
         FROM patient_encounters pe
         JOIN patients p ON p.id = pe.patient_id
         WHERE pe.id = soap_note_versions.encounter_id
           AND ${scopeSql}
       )
     LIMIT 1`,
    [params.soapVersionId, ...scopeParams],
  );
  const row = rowRes.rows[0];
  if (!row) throw new Error("SOAP version not found.");
  if (row.lifecycle_state !== SOAP_LIFECYCLE_STATES.DRAFT) {
    throw new Error("Only draft versions can be finalized.");
  }
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify({
        subjective: row.subjective,
        objective: row.objective,
        assessment: row.assessment,
        plan: row.plan,
      }),
    )
    .digest("hex");
  const updated = await query(
    `UPDATE soap_note_versions
     SET lifecycle_state = $3,
         finalized_for_export_at = NOW(),
         finalized_by = $2,
         content_hash = $4,
         draft_transcript = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [params.soapVersionId, params.actorUserId, SOAP_LIFECYCLE_STATES.FINALIZED_FOR_EXPORT, contentHash],
  );
  if ((updated.rowCount ?? 0) === 0) {
    throw new Error("Failed to finalize SOAP version.");
  }
  return { encounterId: row.encounter_id, patientId: row.patient_id, version: row.version };
}

export async function upsertTranscriptionSessionPointer(params: {
  physicianId: string;
  patientId: string;
  encounterId: string;
  soapVersionId: string;
  previewSummary: string | null;
}): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM physician_transcription_sessions
     WHERE encounter_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.encounterId],
  );
  if (existing.rowCount && existing.rows[0].id) {
    await query(
      `UPDATE physician_transcription_sessions
       SET soap_version_id = $2,
           preview_summary = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, params.soapVersionId, params.previewSummary],
    );
    return existing.rows[0].id;
  }
  const inserted = await query<{ id: string }>(
    `INSERT INTO physician_transcription_sessions (
       physician_id, patient_id, encounter_id, soap_version_id, preview_summary
     ) VALUES ($1,$2,$3,$4,$5)
     RETURNING id`,
    [
      params.physicianId,
      params.patientId,
      params.encounterId,
      params.soapVersionId,
      params.previewSummary,
    ],
  );
  return inserted.rows[0].id;
}

export async function recordEmrExportAttempt(params: {
  soapVersionId: string;
  physicianId: string;
  idempotencyKey: string;
  status: "pending" | "sent" | "failed";
  destinationSystem?: string | null;
  destinationClinic?: string | null;
  externalReferenceId?: string | null;
  errorMessage?: string | null;
}): Promise<{ id: string; encounterId: string; patientId: string }> {
  const versionRes = await query<{ encounter_id: string; patient_id: string }>(
    `SELECT encounter_id, patient_id
     FROM soap_note_versions
     WHERE id = $1
     LIMIT 1`,
    [params.soapVersionId],
  );
  if (versionRes.rowCount === 0) {
    throw new Error("SOAP version not found.");
  }
  const version = versionRes.rows[0];
  const upserted = await query<{ id: string; encounter_id: string; patient_id: string }>(
    `INSERT INTO emr_exports (
       soap_version_id, encounter_id, patient_id, physician_id,
       status, idempotency_key, external_reference_id,
       destination_system, destination_clinic, error_message
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (soap_version_id, idempotency_key)
     DO UPDATE SET
       status = EXCLUDED.status,
       external_reference_id = COALESCE(EXCLUDED.external_reference_id, emr_exports.external_reference_id),
       destination_system = COALESCE(EXCLUDED.destination_system, emr_exports.destination_system),
       destination_clinic = COALESCE(EXCLUDED.destination_clinic, emr_exports.destination_clinic),
       error_message = EXCLUDED.error_message,
       retry_count = CASE WHEN EXCLUDED.status = $11 THEN emr_exports.retry_count + 1 ELSE emr_exports.retry_count END,
       updated_at = NOW()
     RETURNING id, encounter_id, patient_id`,
    [
      params.soapVersionId,
      version.encounter_id,
      version.patient_id,
      params.physicianId,
      params.status,
      params.idempotencyKey,
      params.externalReferenceId || null,
      params.destinationSystem || null,
      params.destinationClinic || null,
      params.errorMessage || null,
      EMR_EXPORT_STATUS.FAILED,
    ],
  );
  return {
    id: upserted.rows[0].id,
    encounterId: upserted.rows[0].encounter_id,
    patientId: upserted.rows[0].patient_id,
  };
}

export async function getTranscriptionSessionsForPhysician(physicianId: string) {
  const res = await query<{
    transcription_session_id: string;
    encounter_id: string;
    soap_version_id: string;
    patient_id: string;
    patient_name: string;
    chief_complaint: string | null;
    lifecycle_state: string;
    version: number;
    preview_summary: string | null;
    created_at: Date;
    finalized_for_export_at: Date | null;
  }>(
    `SELECT
       pts.id AS transcription_session_id,
       pts.encounter_id,
       pts.soap_version_id,
       pts.patient_id,
       p.full_name AS patient_name,
       pe.chief_complaint,
       snv.lifecycle_state,
       snv.version,
       pts.preview_summary,
       pts.created_at,
       snv.finalized_for_export_at
     FROM physician_transcription_sessions pts
     JOIN patients p ON p.id = pts.patient_id
     JOIN patient_encounters pe ON pe.id = pts.encounter_id
     JOIN soap_note_versions snv ON snv.id = pts.soap_version_id
     WHERE pts.physician_id = $1
     ORDER BY pts.created_at DESC`,
    [physicianId],
  );
  return res.rows.map((r) => ({
    transcriptionSessionId: r.transcription_session_id,
    encounterId: r.encounter_id,
    soapVersionId: r.soap_version_id,
    patientId: r.patient_id,
    patientName: r.patient_name,
    chiefComplaint: r.chief_complaint,
    lifecycleState: r.lifecycle_state,
    version: r.version,
    previewSummary: r.preview_summary,
    createdAt: r.created_at.toISOString(),
    finalizedForExportAt: r.finalized_for_export_at ? r.finalized_for_export_at.toISOString() : null,
  }));
}

export async function getTranscriptionSessionsForScope(scope: Scope) {
  const { sql: scopeSql, params: scopeParams } = scopeWhere(scope, 1);
  const res = await query<{
    transcription_session_id: string;
    encounter_id: string;
    soap_version_id: string;
    patient_id: string;
    patient_name: string;
    chief_complaint: string | null;
    lifecycle_state: string;
    version: number;
    preview_summary: string | null;
    created_at: Date;
    finalized_for_export_at: Date | null;
  }>(
    `SELECT
       pts.id AS transcription_session_id,
       pts.encounter_id,
       pts.soap_version_id,
       pts.patient_id,
       p.full_name AS patient_name,
       pe.chief_complaint,
       snv.lifecycle_state,
       snv.version,
       pts.preview_summary,
       pts.created_at,
       snv.finalized_for_export_at
     FROM physician_transcription_sessions pts
     JOIN patients p ON p.id = pts.patient_id
     JOIN patient_encounters pe ON pe.id = pts.encounter_id
     JOIN soap_note_versions snv ON snv.id = pts.soap_version_id
     WHERE ${scopeSql}
     ORDER BY pts.created_at DESC`,
    scopeParams,
  );
  return res.rows.map((r) => ({
    transcriptionSessionId: r.transcription_session_id,
    encounterId: r.encounter_id,
    soapVersionId: r.soap_version_id,
    patientId: r.patient_id,
    patientName: r.patient_name,
    chiefComplaint: r.chief_complaint,
    lifecycleState: r.lifecycle_state,
    version: r.version,
    previewSummary: r.preview_summary,
    createdAt: r.created_at.toISOString(),
    finalizedForExportAt: r.finalized_for_export_at ? r.finalized_for_export_at.toISOString() : null,
  }));
}

export async function getSoapVersionById(params: { soapVersionId: string; physicianId: string }) {
  const res = await query<{
    id: string;
    encounter_id: string;
    patient_id: string;
    version: number;
    lifecycle_state: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    draft_transcript: string | null;
    finalized_for_export_at: Date | null;
  }>(
    `SELECT
       snv.id, snv.encounter_id, snv.patient_id, snv.version, snv.lifecycle_state,
       snv.subjective, snv.objective, snv.assessment, snv.plan, snv.draft_transcript, snv.finalized_for_export_at
     FROM soap_note_versions snv
     JOIN patient_encounters pe ON pe.id = snv.encounter_id
     WHERE snv.id = $1
       AND pe.physician_id = $2
     LIMIT 1`,
    [params.soapVersionId, params.physicianId],
  );
  return res.rows[0] || null;
}

export async function getSoapVersionByIdForScope(params: { soapVersionId: string; scope: Scope }) {
  const { sql: scopeSql, params: scopeParams } = scopeWhere(params.scope, 2);
  const res = await query<{
    id: string;
    encounter_id: string;
    patient_id: string;
    version: number;
    lifecycle_state: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    draft_transcript: string | null;
    finalized_for_export_at: Date | null;
  }>(
    `SELECT
       snv.id, snv.encounter_id, snv.patient_id, snv.version, snv.lifecycle_state,
       snv.subjective, snv.objective, snv.assessment, snv.plan, snv.draft_transcript, snv.finalized_for_export_at
     FROM soap_note_versions snv
     JOIN patient_encounters pe ON pe.id = snv.encounter_id
     JOIN patients p ON p.id = pe.patient_id
     WHERE snv.id = $1
       AND ${scopeSql}
     LIMIT 1`,
    [params.soapVersionId, ...scopeParams],
  );
  return res.rows[0] || null;
}
