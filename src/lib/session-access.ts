import type { UserSession } from "@/lib/auth";
import { query } from "@/lib/db";

export type SessionAccessScope = {
  physicianId: string;
  organizationId: string | null;
};

export function isWorkforceSessionViewer(session: UserSession): boolean {
  return session.userType === "provider" || session.userType === "org_admin";
}

export function canAccessSessionInScope(params: {
  viewer: UserSession;
  resource: SessionAccessScope;
}): boolean {
  const { viewer, resource } = params;
  if (!isWorkforceSessionViewer(viewer)) return false;

  if (resource.organizationId) {
    return !!viewer.organizationId && viewer.organizationId === resource.organizationId;
  }

  // Legacy fallback for org-null sessions: only the owning provider can access.
  return viewer.userType === "provider" && resource.physicianId === viewer.userId;
}

export async function loadSessionAccessScope(
  sessionCode: string,
): Promise<SessionAccessScope | null> {
  const result = await query<{ physician_id: string; organization_id: string | null }>(
    `SELECT ps.physician_id, ph.organization_id
     FROM patient_sessions ps
     JOIN physicians ph ON ph.id = ps.physician_id
     WHERE ps.session_code = $1
     LIMIT 1`,
    [sessionCode],
  );
  if (result.rows.length === 0) return null;
  return {
    physicianId: result.rows[0].physician_id,
    organizationId: result.rows[0].organization_id ?? null,
  };
}

export async function loadSessionPatientId(sessionCode: string): Promise<string | null> {
  const patientResult = await query<{ patient_id: string }>(
    `SELECT patient_id
     FROM patient_encounters
     WHERE source_session_code = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionCode],
  );
  return patientResult.rows[0]?.patient_id || null;
}
