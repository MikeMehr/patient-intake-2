import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

async function hasRecoveryColumns(tableName: "organization_users" | "super_admin_users"): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = 'backup_codes_required'
     ) AS exists`,
    [tableName],
  );
  return Boolean(result.rows[0]?.exists);
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || session.userType !== "super_admin") {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Super admin access required" },
        { status },
      );
      logRequestMeta("/api/admin/workforce", requestId, status, Date.now() - started);
      return res;
    }

    const superAdminHasRecoveryColumns = await hasRecoveryColumns("super_admin_users");
    const orgAdminHasRecoveryColumns = await hasRecoveryColumns("organization_users");

    const superAdminsResult = await query<{
      id: string;
      username: string;
      email: string;
      first_name: string;
      last_name: string;
      mfa_enabled: boolean;
      backup_codes_required: boolean;
      mfa_recovery_reset_at: Date | null;
    }>(
      `SELECT id, username, email, first_name, last_name, mfa_enabled,
              ${
                superAdminHasRecoveryColumns
                  ? "backup_codes_required, mfa_recovery_reset_at"
                  : "FALSE AS backup_codes_required, NULL::timestamptz AS mfa_recovery_reset_at"
              }
       FROM super_admin_users
       ORDER BY created_at ASC`,
    );
    const orgAdminsResult = await query<{
      id: string;
      organization_id: string;
      organization_name: string;
      username: string;
      email: string;
      first_name: string;
      last_name: string;
      mfa_enabled: boolean;
      backup_codes_required: boolean;
      mfa_recovery_reset_at: Date | null;
    }>(
      `SELECT ou.id, ou.organization_id, o.name AS organization_name, ou.username, ou.email, ou.first_name, ou.last_name,
              ou.mfa_enabled,
              ${
                orgAdminHasRecoveryColumns
                  ? "ou.backup_codes_required, ou.mfa_recovery_reset_at"
                  : "FALSE AS backup_codes_required, NULL::timestamptz AS mfa_recovery_reset_at"
              }
       FROM organization_users ou
       JOIN organizations o ON o.id = ou.organization_id
       ORDER BY o.name ASC, ou.created_at ASC`,
    );

    const res = NextResponse.json({
      superAdmins: superAdminsResult.rows.map((row) => ({
        id: row.id,
        username: row.username,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        mfaEnabled: row.mfa_enabled,
        backupCodesRequired: row.backup_codes_required,
        recoveryResetAt: row.mfa_recovery_reset_at ? new Date(row.mfa_recovery_reset_at).toISOString() : null,
      })),
      orgAdmins: orgAdminsResult.rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        username: row.username,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        mfaEnabled: row.mfa_enabled,
        backupCodesRequired: row.backup_codes_required,
        recoveryResetAt: row.mfa_recovery_reset_at ? new Date(row.mfa_recovery_reset_at).toISOString() : null,
      })),
    });
    logRequestMeta("/api/admin/workforce", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/workforce] GET Error", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/admin/workforce", requestId, status, Date.now() - started);
    return res;
  }
}
