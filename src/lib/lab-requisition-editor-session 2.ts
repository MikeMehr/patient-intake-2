import { query } from "@/lib/db";
import type { LabRequisitionPrefillPayload } from "@/lib/lab-requisition-payload";

export type LabEditorFieldValue = string | boolean;

export type LabEditorSessionPayload = LabRequisitionPrefillPayload & {
  editorFields?: Record<string, LabEditorFieldValue>;
};

export async function createLabEditorSession(params: {
  physicianId: string;
  sessionCode: string;
  payload: LabEditorSessionPayload;
  sourceRequisitionId?: string | null;
  ttlMinutes?: number;
}): Promise<string> {
  const ttlMinutes = Number.isFinite(params.ttlMinutes) ? Number(params.ttlMinutes) : 30;
  const result = await query<{ token: string }>(
    `INSERT INTO lab_requisition_editor_sessions (
      physician_id, session_code, source_requisition_id, payload_json, expires_at
    ) VALUES ($1,$2,$3,$4,NOW() + ($5::text || ' minutes')::interval)
    RETURNING token`,
    [
      params.physicianId,
      params.sessionCode,
      params.sourceRequisitionId ?? null,
      JSON.stringify(params.payload),
      String(Math.max(5, ttlMinutes)),
    ],
  );
  const token = result.rows[0]?.token;
  if (!token) {
    throw new Error("Failed to create editor session token.");
  }
  return token;
}

export async function getLabEditorSession(token: string, physicianId: string) {
  const result = await query<{
    token: string;
    session_code: string;
    payload_json: LabEditorSessionPayload;
    expires_at: Date;
  }>(
    `SELECT token, session_code, payload_json, expires_at
     FROM lab_requisition_editor_sessions
     WHERE token = $1
       AND physician_id = $2
       AND expires_at > NOW()
     LIMIT 1`,
    [token, physicianId],
  );
  return result.rows[0] ?? null;
}

