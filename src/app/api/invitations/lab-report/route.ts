/**
 * GET /api/invitations/lab-report
 * Get lab report summary for a patient invitation
 */

import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { resolveInvitationFromCookie } from "@/lib/invitation-security";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const invitation = await resolveInvitationFromCookie();
    if (!invitation) {
      status = 401;
      const res = NextResponse.json(
        { error: "Invitation session required" },
        { status }
      );
      logRequestMeta("/api/invitations/lab-report", requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({
      labReportSummary: invitation.labReportSummary || null,
      previousLabReportSummary: invitation.previousLabReportSummary || null,
      formSummary: invitation.formSummary || null,
      patientBackground: invitation.patientBackground || null,
      interviewGuidance: invitation.interviewGuidance || null,
    });
    logRequestMeta("/api/invitations/lab-report", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[invitations/lab-report] Error");
    const res = NextResponse.json(
      { error: "Internal server error" },
      { status }
    );
    logRequestMeta("/api/invitations/lab-report", requestId, status, Date.now() - started);
    return res;
  }
}


