/**
 * GET /api/org/organization - Get current organization info (org admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getOrganizationById, getOrgAdminContext } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    const orgContext = await getOrgAdminContext(session);
    if (!orgContext) {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Booking Dashboard access required" },
        { status }
      );
      logRequestMeta("/api/org/organization", requestId, status, Date.now() - started);
      return res;
    }

    const organization = await getOrganizationById(orgContext.organizationId);
    const slugRow = await query<{ slug: string | null }>(
      "SELECT slug FROM organizations WHERE id = $1",
      [orgContext.organizationId]
    );
    if (!organization) {
      status = 404;
      const res = NextResponse.json(
        { error: "Organization not found" },
        { status }
      );
      logRequestMeta("/api/org/organization", requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({
      organization: {
        id: organization.id,
        name: organization.name,
        email: organization.email,
        businessAddress: organization.business_address,
        phone: organization.phone,
        fax: organization.fax,
        isActive: organization.is_active,
        slug: slugRow.rows[0]?.slug ?? null,
      },
    });
    logRequestMeta("/api/org/organization", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[org/organization] GET Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/org/organization", requestId, status, Date.now() - started);
    return res;
  }
}

