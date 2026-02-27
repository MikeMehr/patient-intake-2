/**
 * GET /api/admin/organizations/[id] - Get organization details with providers
 * PUT /api/admin/organizations/[id] - Update organization (super admin only)
 * DELETE /api/admin/organizations/[id] - Delete organization (super admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

function normalizeWebsiteUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function hasOrganizationWebsiteColumn(): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'organizations'
         AND column_name = 'website_url'
     ) AS exists`,
  );
  return Boolean(result.rows[0]?.exists);
}

async function hasOrganizationUserRecoveryColumns(): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'organization_users'
         AND column_name = 'backup_codes_required'
     ) AS exists`,
  );
  return Boolean(result.rows[0]?.exists);
}

export async function GET(
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
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;

    const supportsWebsiteUrl = await hasOrganizationWebsiteColumn();
    const websiteColumnSelect = supportsWebsiteUrl
      ? "website_url"
      : "NULL::varchar AS website_url";

    // Get organization details
    const orgResult = await query<{
      id: string;
      name: string;
      email: string;
      business_address: string;
      phone: string | null;
      fax: string | null;
      website_url: string | null;
      is_active: boolean;
      created_at: Date;
    }>(
      `SELECT id, name, email, business_address, phone, fax, ${websiteColumnSelect}, is_active, created_at
       FROM organizations
       WHERE id = $1`,
      [id]
    );

    if (orgResult.rows.length === 0) {
      status = 404;
      const res = NextResponse.json(
        { error: "Organization not found" },
        { status }
      );
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }

    const org = orgResult.rows[0];

    // Get providers for this organization
    const providersResult = await query<{
      id: string;
      first_name: string;
      last_name: string;
      username: string;
      email: string | null;
      phone: string | null;
      unique_slug: string;
      created_at: Date;
    }>(
      `SELECT id, first_name, last_name, username, email, phone, unique_slug, created_at
       FROM physicians
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [id]
    );

    const hasOrgAdminRecoveryColumns = await hasOrganizationUserRecoveryColumns();
    const orgAdminsResult = await query<{
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
                hasOrgAdminRecoveryColumns
                  ? "backup_codes_required, mfa_recovery_reset_at"
                  : "FALSE AS backup_codes_required, NULL::timestamptz AS mfa_recovery_reset_at"
              }
       FROM organization_users
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [id],
    );

    const res = NextResponse.json({
      organization: {
        id: org.id,
        name: org.name,
        email: org.email,
        businessAddress: org.business_address,
        phone: org.phone,
        fax: org.fax,
        websiteUrl: org.website_url,
        isActive: org.is_active,
        createdAt: org.created_at,
      },
      providers: providersResult.rows.map((p) => ({
        id: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        username: p.username,
        email: p.email,
        phone: p.phone,
        uniqueSlug: p.unique_slug,
        createdAt: p.created_at,
      })),
      orgAdmins: orgAdminsResult.rows.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        mfaEnabled: u.mfa_enabled,
        backupCodesRequired: u.backup_codes_required,
        recoveryResetAt: u.mfa_recovery_reset_at ? new Date(u.mfa_recovery_reset_at).toISOString() : null,
      })),
    });
    logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/organizations/[id]] GET Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
    return res;
  }
}

export async function PUT(
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
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;
    const body = await request.json();
    const { name, email, businessAddress, phone, fax, isActive } = body;
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.toLowerCase().trim() : "";
    const normalizedBusinessAddress =
      typeof businessAddress === "string" ? businessAddress.trim() : "";
    const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
    const normalizedFax = typeof fax === "string" ? fax.trim() : "";
    const normalizedIsActive = typeof isActive === "boolean" ? isActive : undefined;
    const supportsWebsiteUrl = await hasOrganizationWebsiteColumn();
    const websiteUrl = normalizeWebsiteUrl(body?.websiteUrl);
    if (body?.websiteUrl !== undefined && websiteUrl === undefined) {
      status = 400;
      const res = NextResponse.json(
        { error: "Invalid website URL. Use a valid http(s) URL." },
        { status },
      );
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }
    if (!supportsWebsiteUrl && body?.websiteUrl) {
      status = 503;
      const res = NextResponse.json(
        { error: "Organization website requires DB migration 024_add_organization_website.sql." },
        { status },
      );
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }
    if (!normalizedName || !normalizedEmail || !normalizedBusinessAddress) {
      status = 400;
      const res = NextResponse.json(
        { error: "Name, email, and business address are required" },
        { status }
      );
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }
    if (!emailRegex.test(normalizedEmail)) {
      status = 400;
      const res = NextResponse.json(
        { error: "Invalid email address" },
        { status }
      );
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }
    if (normalizedIsActive === undefined) {
      status = 400;
      const res = NextResponse.json(
        { error: "Invalid organization status" },
        { status }
      );
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }

    // Check if organization exists
    const existingOrg = await query<{ id: string }>(
      `SELECT id FROM organizations WHERE id = $1`,
      [id]
    );

    if (existingOrg.rows.length === 0) {
      status = 404;
      const res = NextResponse.json(
        { error: "Organization not found" },
        { status }
      );
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }
    const duplicateEmail = await query<{ id: string }>(
      `SELECT id FROM organizations WHERE email = $1 AND id <> $2 LIMIT 1`,
      [normalizedEmail, id]
    );
    if (duplicateEmail.rows.length > 0) {
      status = 409;
      const res = NextResponse.json(
        { error: "An organization with this email already exists" },
        { status }
      );
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }

    // Update organization
    await query(
      supportsWebsiteUrl
        ? `UPDATE organizations
           SET name = $1, email = $2, business_address = $3, phone = $4, fax = $5, is_active = $6, website_url = $7
           WHERE id = $8`
        : `UPDATE organizations
           SET name = $1, email = $2, business_address = $3, phone = $4, fax = $5, is_active = $6
           WHERE id = $7`,
      supportsWebsiteUrl
        ? [
            normalizedName,
            normalizedEmail,
            normalizedBusinessAddress,
            normalizedPhone || null,
            normalizedFax || null,
            normalizedIsActive,
            websiteUrl,
            id,
          ]
        : [
            normalizedName,
            normalizedEmail,
            normalizedBusinessAddress,
            normalizedPhone || null,
            normalizedFax || null,
            normalizedIsActive,
            id,
          ]
    );

    const res = NextResponse.json({ success: true });
    logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/organizations/[id]] PUT Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
    return res;
  }
}

export async function DELETE(
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
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }

    const { id } = await params;

    // Check if organization exists
    const existingOrg = await query<{ id: string }>(
      `SELECT id FROM organizations WHERE id = $1`,
      [id]
    );

    if (existingOrg.rows.length === 0) {
      status = 404;
      const res = NextResponse.json(
        { error: "Organization not found" },
        { status }
      );
      logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
      return res;
    }

    // Delete organization (cascade will handle related records)
    await query(`DELETE FROM organizations WHERE id = $1`, [id]);

    const res = NextResponse.json({ success: true });
    logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/organizations/[id]] DELETE Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/admin/organizations/[id]", requestId, status, Date.now() - started);
    return res;
  }
}

