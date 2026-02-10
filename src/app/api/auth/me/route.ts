/**
 * GET /api/auth/me
 * Get current authenticated physician information
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getOrganizationById } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();

    if (!session) {
      status = 401;
      const res = NextResponse.json(
        { error: "Not authenticated" },
        { status }
      );
      logRequestMeta("/api/auth/me", requestId, status, Date.now() - started);
      return res;
    }

    let clinicAddress = session.clinicAddress ?? null;

    // If provider has no clinicAddress, fall back to organization businessAddress
    if (session.userType === "provider" && !clinicAddress && session.organizationId) {
      try {
        const org = await getOrganizationById(session.organizationId);
        if (org?.business_address) {
          clinicAddress = org.business_address;
          // Persist back to physicians table for future requests
          await query(
            `UPDATE physicians SET clinic_address = $1 WHERE id = $2`,
            [clinicAddress, session.userId]
          );
        }
      } catch (err) {
        // Non-fatal; just skip if org lookup fails
        console.error("[auth/me] Failed to backfill clinic_address from organization", err);
      }
    }

    const res = NextResponse.json({
      physician: {
        id: session.userId,
        username: session.username,
        firstName: session.firstName,
        lastName: session.lastName,
        clinicName: session.clinicName,
        clinicAddress,
      },
    });
    logRequestMeta("/api/auth/me", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[auth/me] Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/auth/me", requestId, status, Date.now() - started);
    return res;
  }
}

