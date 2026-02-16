import { NextRequest, NextResponse } from "next/server";
import { patientSessionExists } from "@/lib/session-store";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { resolveInvitationFromCookie } from "@/lib/invitation-security";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  const invitation = await resolveInvitationFromCookie();
  if (!invitation) {
    status = 401;
    const res = NextResponse.json(
      { error: "Invitation session required" },
      { status },
    );
    logRequestMeta("/api/sessions/check", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const exists = await patientSessionExists({
      patientEmail: invitation.patientEmail,
      patientName: invitation.patientName,
      physicianId: invitation.physicianId,
    });

    const res = NextResponse.json({ exists });
    logRequestMeta("/api/sessions/check", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[sessions-check-route] Error checking patient session existence", { requestId });
    status = 500;
    const res = NextResponse.json(
      { error: "Failed to check session status" },
      { status },
    );
    logRequestMeta("/api/sessions/check", requestId, status, Date.now() - started);
    return res;
  }
}


