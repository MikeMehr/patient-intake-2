/**
 * POST /api/org/act-as-provider
 *
 * Lets a signed-in org admin (or super admin) open the Physician Dashboard of one
 * of their own providers WITHOUT a second login. We mint a provider session for the
 * target provider and record the originating org-admin id on it so the user can switch
 * back to the Booking Dashboard afterwards (see /api/org/return-to-admin).
 *
 * Authorization: the provider must belong to the org admin's organization. Super admins
 * may act as any provider.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, createSession } from "@/lib/auth";
import { getProviderById } from "@/lib/auth-helpers";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || (session.userType !== "org_admin" && session.userType !== "super_admin")) {
      status = 401;
      const res = NextResponse.json(
        { error: "Unauthorized - Organization admin access required" },
        { status }
      );
      logRequestMeta("/api/org/act-as-provider", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json().catch(() => ({}));
    const providerId = typeof body?.providerId === "string" ? body.providerId.trim() : "";
    if (!providerId) {
      status = 400;
      const res = NextResponse.json({ error: "providerId is required" }, { status });
      logRequestMeta("/api/org/act-as-provider", requestId, status, Date.now() - started);
      return res;
    }

    const provider = await getProviderById(providerId);
    if (!provider) {
      status = 404;
      const res = NextResponse.json({ error: "Provider not found" }, { status });
      logRequestMeta("/api/org/act-as-provider", requestId, status, Date.now() - started);
      return res;
    }

    // Org admins may only act as providers within their own organization.
    if (
      session.userType === "org_admin" &&
      (!provider.organization_id || provider.organization_id !== session.organizationId)
    ) {
      status = 403;
      const res = NextResponse.json(
        { error: "This provider does not belong to your organization" },
        { status }
      );
      logRequestMeta("/api/org/act-as-provider", requestId, status, Date.now() - started);
      return res;
    }

    // Mint a provider session, replacing the current cookie. Record the org admin id so
    // the user can switch back without re-entering credentials.
    await createSession(
      provider.id,
      "provider",
      provider.username,
      provider.first_name,
      provider.last_name,
      provider.organization_id,
      provider.clinic_name,
      provider.clinic_address,
      null,
      session.userId
    );

    const res = NextResponse.json({ ok: true, redirectTo: "/physician/dashboard" });
    logRequestMeta("/api/org/act-as-provider", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[org/act-as-provider] Error");
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/act-as-provider", requestId, status, Date.now() - started);
    return res;
  }
}
