/**
 * POST /api/admin/organizations/[id]/admins - Create an organization admin account
 *   (super admin only). These are the accounts used to sign in at /org/login.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, hashPassword, validatePassword } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernameRegex = /^[a-z0-9][a-z0-9._-]{2,}$/;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
        { status }
      );
      logRequestMeta("/api/admin/organizations/[id]/admins", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const username = typeof body?.username === "string" ? body.username.toLowerCase().trim() : "";
    const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : "";
    const firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || !email || !firstName || !lastName || !password) {
      status = 400;
      const res = NextResponse.json(
        { error: "Username, email, first name, last name, and password are required" },
        { status }
      );
      logRequestMeta("/api/admin/organizations/[id]/admins", requestId, status, Date.now() - started);
      return res;
    }
    if (!usernameRegex.test(username)) {
      status = 400;
      const res = NextResponse.json(
        { error: "Username must be at least 3 characters: lowercase letters, numbers, dot, dash, or underscore" },
        { status }
      );
      logRequestMeta("/api/admin/organizations/[id]/admins", requestId, status, Date.now() - started);
      return res;
    }
    if (!emailRegex.test(email)) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid email address" }, { status });
      logRequestMeta("/api/admin/organizations/[id]/admins", requestId, status, Date.now() - started);
      return res;
    }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      status = 400;
      const res = NextResponse.json({ error: passwordCheck.error }, { status });
      logRequestMeta("/api/admin/organizations/[id]/admins", requestId, status, Date.now() - started);
      return res;
    }

    // Ensure the organization exists
    const existingOrg = await query<{ id: string }>(
      `SELECT id FROM organizations WHERE id = $1`,
      [id]
    );
    if (existingOrg.rows.length === 0) {
      status = 404;
      const res = NextResponse.json({ error: "Organization not found" }, { status });
      logRequestMeta("/api/admin/organizations/[id]/admins", requestId, status, Date.now() - started);
      return res;
    }

    // username/email are globally unique in organization_users
    const duplicate = await query<{ id: string }>(
      `SELECT id FROM organization_users WHERE username = $1 OR email = $2 LIMIT 1`,
      [username, email]
    );
    if (duplicate.rows.length > 0) {
      status = 409;
      const res = NextResponse.json(
        { error: "An admin account with this username or email already exists" },
        { status }
      );
      logRequestMeta("/api/admin/organizations/[id]/admins", requestId, status, Date.now() - started);
      return res;
    }

    const passwordHash = await hashPassword(password);

    const result = await query<{ id: string }>(
      `INSERT INTO organization_users
         (organization_id, username, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'org_admin')
       RETURNING id`,
      [id, username, email, passwordHash, firstName, lastName]
    );

    const res = NextResponse.json({ success: true, id: result.rows[0].id });
    logRequestMeta("/api/admin/organizations/[id]/admins", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/organizations/[id]/admins] POST Error");
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/admin/organizations/[id]/admins", requestId, status, Date.now() - started);
    return res;
  }
}
