/**
 * PUT /api/admin/super-admin-users/[id] — update a super admin account.
 *
 * Completes the set: mfa_enabled was added to all three workforce tables in migration 025,
 * but nothing could write it on super_admin_users (the only statement touching that table
 * was `SET last_login`, and scripts/create-super-admin.js omits the column). The login and
 * challenge paths were always ready — /api/auth/login issues the challenge and
 * /api/auth/login/mfa/verify has a super_admin branch — so this is the last missing piece.
 *
 * Super admin only, like every other route under /api/admin. There is no higher role, so
 * super admins necessarily administer each other; that also means a super admin locked out
 * of MFA has no in-app recovery. Backup codes are the safety net —
 * /api/admin/super-admin-users/[id]/mfa/backup-codes — and the dashboard nudges for them
 * before this is switched on.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getBackupCodeStatus } from "@/lib/auth-mfa";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const ROUTE = "/api/admin/super-admin-users/[id]";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { mfaEnabled } = body ?? {};

    if (mfaEnabled === undefined) {
      status = 400;
      const res = NextResponse.json({ error: "No fields to update" }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    const existing = await query<{ id: string }>(
      `SELECT id FROM super_admin_users WHERE id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      status = 404;
      const res = NextResponse.json({ error: "Super admin not found" }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    // Enforced here rather than in the dashboard, so a direct API call cannot skip it.
    // backup_codes_required is the wrong signal: it defaults to FALSE and only flips TRUE
    // after an admin reset, so an account that never generated codes reads "not required"
    // — exactly the account this protects. Count the live codes instead.
    if (mfaEnabled) {
      const codes = await getBackupCodeStatus({ userType: "super_admin", userId: id });
      if (codes.activeCodes === 0) {
        status = 409;
        const res = NextResponse.json(
          {
            error:
              "Generate backup codes for this super admin before enabling MFA. No role can " +
              "recover a super admin, so if email delivery fails those codes are the only way back in.",
          },
          { status },
        );
        logRequestMeta(ROUTE, requestId, status, Date.now() - started);
        return res;
      }
    }

    // No session purge either way: this governs the next sign-in, and login re-reads the
    // column every time. Turning it on should not eject the admin from the page they used
    // to turn it on.
    const updated = await query<{ id: string; mfa_enabled: boolean }>(
      `UPDATE super_admin_users
       SET mfa_enabled = $1
       WHERE id = $2
       RETURNING id, mfa_enabled`,
      [Boolean(mfaEnabled), id],
    );

    const res = NextResponse.json({
      success: true,
      superAdmin: {
        id: updated.rows[0].id,
        mfaEnabled: updated.rows[0].mfa_enabled,
      },
    });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/super-admin-users/[id]] PUT Error", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }
}
