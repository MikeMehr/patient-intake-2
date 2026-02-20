import { query } from "@/lib/db";

export async function logPhysicianPhiAudit(params: {
  physicianId?: string | null;
  patientId?: string | null;
  encounterId?: string | null;
  soapVersionId?: string | null;
  eventType: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await query(
    `INSERT INTO physician_phi_audit_log (
       physician_id, patient_id, encounter_id, soap_version_id,
       event_type, ip_address, user_agent, metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      params.physicianId || null,
      params.patientId || null,
      params.encounterId || null,
      params.soapVersionId || null,
      params.eventType,
      params.ipAddress || null,
      params.userAgent || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ],
  );
}
