import { NextResponse } from "next/server";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { resolveInvitationFromCookie } from "@/lib/invitation-security";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const invitation = await resolveInvitationFromCookie();
    if (!invitation) {
      status = 401;
      const res = NextResponse.json({ error: "Invitation session required" }, { status });
      logRequestMeta("/api/invitations/context", requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({
      invitationId: invitation.invitationId,
      physicianId: invitation.physicianId,
      physicianName: invitation.physicianName,
      clinicName: invitation.clinicName,
      organizationWebsiteUrl: invitation.organizationWebsiteUrl || null,
      patientName: invitation.patientName,
      patientEmail: invitation.patientEmail,
      patientDob: invitation.patientDob,
      oscarDemographicNo: invitation.oscarDemographicNo,
      labReportSummary: invitation.labReportSummary || null,
      previousLabReportSummary: invitation.previousLabReportSummary || null,
      formSummary: invitation.formSummary || null,
      patientBackground: invitation.patientBackground || null,
      interviewGuidance: invitation.interviewGuidance || null,
      usedAt: invitation.usedAt || null,
    });
    logRequestMeta("/api/invitations/context", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    console.error("[invitations/context] Error", error);
    status = 500;
    const res = NextResponse.json({ error: "Internal server error" }, { status });
    logRequestMeta("/api/invitations/context", requestId, status, Date.now() - started);
    return res;
  }
}
