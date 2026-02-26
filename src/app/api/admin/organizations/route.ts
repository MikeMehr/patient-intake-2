/**
 * GET /api/admin/organizations - List all organizations (super admin only)
 * POST /api/admin/organizations - Create new organization (super admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

function normalizeWebsiteUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

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
        { status }
      );
      logRequestMeta("/api/admin/organizations", requestId, status, Date.now() - started);
      return res;
    }

    const supportsWebsiteUrl = await hasOrganizationWebsiteColumn();
    const websiteColumnSelect = supportsWebsiteUrl
      ? "o.website_url"
      : "NULL::varchar AS website_url";

    // Get all organizations with provider count
    const result = await query<{
      id: string;
      name: string;
      email: string;
      business_address: string;
      phone: string | null;
      fax: string | null;
      website_url: string | null;
      is_active: boolean;
      created_at: Date;
      provider_count: string;
    }>(
      `SELECT 
        o.id,
        o.name,
        o.email,
        o.business_address,
        o.phone,
        o.fax,
        ${websiteColumnSelect},
        o.is_active,
        o.created_at,
        COUNT(p.id)::text as provider_count
      FROM organizations o
      LEFT JOIN physicians p ON p.organization_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC`
    );

    const res = NextResponse.json({
      organizations: result.rows.map((org) => ({
        id: org.id,
        name: org.name,
        email: org.email,
        businessAddress: org.business_address,
        phone: org.phone,
        fax: org.fax,
        websiteUrl: org.website_url,
        isActive: org.is_active,
        createdAt: org.created_at,
        providerCount: parseInt(org.provider_count) || 0,
      })),
    });
    logRequestMeta("/api/admin/organizations", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/organizations] GET Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/admin/organizations", requestId, status, Date.now() - started);
    return res;
  }
}

export async function POST(request: NextRequest) {
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
      logRequestMeta("/api/admin/organizations", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json();
    const { name, email, businessAddress, phone, fax } = body;
    const supportsWebsiteUrl = await hasOrganizationWebsiteColumn();
    const websiteUrl = normalizeWebsiteUrl(body?.websiteUrl);

    if (!name || !email || !businessAddress) {
      status = 400;
      const res = NextResponse.json(
        { error: "Name, email, and business address are required" },
        { status }
      );
      logRequestMeta("/api/admin/organizations", requestId, status, Date.now() - started);
      return res;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      status = 400;
      const res = NextResponse.json(
        { error: "Invalid email address" },
        { status }
      );
      logRequestMeta("/api/admin/organizations", requestId, status, Date.now() - started);
      return res;
    }
    if (body?.websiteUrl && !websiteUrl) {
      status = 400;
      const res = NextResponse.json(
        { error: "Invalid website URL. Use a valid http(s) URL." },
        { status },
      );
      logRequestMeta("/api/admin/organizations", requestId, status, Date.now() - started);
      return res;
    }
    if (!supportsWebsiteUrl && body?.websiteUrl) {
      status = 503;
      const res = NextResponse.json(
        { error: "Organization website requires DB migration 024_add_organization_website.sql." },
        { status },
      );
      logRequestMeta("/api/admin/organizations", requestId, status, Date.now() - started);
      return res;
    }

    // Check if email already exists
    const existingOrg = await query<{ id: string }>(
      `SELECT id FROM organizations WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (existingOrg.rows.length > 0) {
      status = 409;
      const res = NextResponse.json(
        { error: "An organization with this email already exists" },
        { status }
      );
      logRequestMeta("/api/admin/organizations", requestId, status, Date.now() - started);
      return res;
    }

    // Create organization
    const result = await query<{ id: string }>(
      supportsWebsiteUrl
        ? `INSERT INTO organizations (name, email, business_address, phone, fax, website_url)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`
        : `INSERT INTO organizations (name, email, business_address, phone, fax)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
      supportsWebsiteUrl
        ? [
            name.trim(),
            email.toLowerCase().trim(),
            businessAddress.trim(),
            phone ? phone.trim() : null,
            fax ? fax.trim() : null,
            websiteUrl,
          ]
        : [
            name.trim(),
            email.toLowerCase().trim(),
            businessAddress.trim(),
            phone ? phone.trim() : null,
            fax ? fax.trim() : null,
          ]
    );

    const res = NextResponse.json({
      success: true,
      organization: {
        id: result.rows[0].id,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        businessAddress: businessAddress.trim(),
        phone: phone ? phone.trim() : null,
        fax: fax ? fax.trim() : null,
        websiteUrl: supportsWebsiteUrl ? websiteUrl : null,
      },
    });
    logRequestMeta("/api/admin/organizations", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[admin/organizations] POST Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/admin/organizations", requestId, status, Date.now() - started);
    return res;
  }
}

