/**
 * POST /api/org/return-to-admin
 *
 * Companion to /api/org/act-as-provider. When the current session is a provider session
 * that was opened by an org admin (impersonatorOrgAdminId is set), this restores an
 * org-admin session for that admin so they land back on the Booking Dashboard — no
 * password re-entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, createSession } from "@/lib/auth";
import { getAuthUserByTypeAndId } from "@/lib/auth-helpers";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const session = await getCurrentSession();
    if (!session || !session.impersonatorOrgAdminId) {
      status = 400;
      const res = NextResponse.json(
        { error: "No booking dashboard session to return to" },
        { status }
      );
      logRequestMeta("/api/org/return-to-admin", requestId, status, Date.now() - started);
      return res;
    }

    const admin = await getAuthUserByTypeAndId("org_admin", session.impersonatorOrgAdminId);
    if (!admin) {
      status = 404;
      const res = NextResponse.json({ error: "Organization admin not found" }, { status });
      logRequestMeta("/api/org/return-to-admin", requestId, status, Date.now() - started);
      return res;
    }

    const orgAdmin = admin as {
      id: string;
      username: string;
      first_name: string;
      last_name: string;
      organization_id: string;
    };

    await createSession(
      orgAdmin.id,
      "org_admin",
      orgAdmin.username,
      orgAdmin.first_name,
      orgAdmin.last_name,
      orgAdmin.organization_id
    );

    const res = NextResponse.json({ ok: true, redirectTo: "/org/dashboard" });
    logRequestMeta("/api/org/return-to-admin", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[org/return-to-admin] Error");
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/org/return-to-admin", requestId, status, Date.now() - started);
    return res;
  }
}
