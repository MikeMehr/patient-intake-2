/**
 * GET /api/admin/organizations/[id] - Get organization details with providers
 * PUT /api/admin/organizations/[id] - Update organization (super admin only)
 * DELETE /api/admin/organizations/[id] - Delete organization (super admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

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

    // Get organization details
    const orgResult = await query<{
      id: string;
      name: string;
      email: string;
      business_address: string;
      phone: string | null;
      fax: string | null;
      is_active: boolean;
      created_at: Date;
    }>(
      `SELECT id, name, email, business_address, phone, fax, is_active, created_at
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

    const res = NextResponse.json({
      organization: {
        id: org.id,
        name: org.name,
        email: org.email,
        businessAddress: org.business_address,
        phone: org.phone,
        fax: org.fax,
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

    // Update organization
    await query(
      `UPDATE organizations
       SET name = $1, email = $2, business_address = $3, phone = $4, fax = $5, is_active = $6
       WHERE id = $7`,
      [
        name?.trim() || undefined,
        email ? email.toLowerCase().trim() : undefined,
        businessAddress?.trim() || undefined,
        phone ? phone.trim() : null,
        fax ? fax.trim() : null,
        isActive !== undefined ? isActive : undefined,
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

