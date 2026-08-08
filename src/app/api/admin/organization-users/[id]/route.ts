/**
 * PUT /api/admin/organization-users/[id] — update an organization admin account.
 *
 * Until this existed there was no write path to organization_users at all beyond
 * `SET last_login` on sign-in, so mfa_enabled — added for all three workforce tables in
 * migration 025 — could never be turned on for an org admin. That left the one account type
 * able to reset any provider's password and mint their MFA backup codes as the only one
 * permanently stuck on single-factor login, while physicians could be toggled from two
 * different edit screens.
 *
 * Super admin only, matching the sibling MFA routes under this path. An org admin must not be
 * able to clear MFA on itself or a peer — that would make the control self-defeating.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const ROUTE = "/api/admin/organization-users/[id]";

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
      `SELECT id FROM organization_users WHERE id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      status = 404;
      const res = NextResponse.json({ error: "Organization admin not found" }, { status });
      logRequestMeta(ROUTE, requestId, status, Date.now() - started);
      return res;
    }

    // No session purge either way. Turning MFA on should not sign the admin out of work in
    // progress — it governs the next sign-in, and login re-reads the column every time.
    const updated = await query<{ id: string; mfa_enabled: boolean }>(
      `UPDATE organization_users
       SET mfa_enabled = $1
       WHERE id = $2
       RETURNING id, mfa_enabled`,
      [Boolean(mfaEnabled), id],
    );

    const res = NextResponse.json({
      success: true,
      organizationUser: {
        id: updated.rows[0].id,
        mfaEnabled: updated.rows[0].mfa_enabled,
      },
    });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/organization-users/[id]] PUT Error", error);
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return res;
  }
}
