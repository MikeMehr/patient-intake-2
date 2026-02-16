import { NextResponse } from "next/server";
import {
  generateSessionCode,
  getSession,
  storeSession,
  sessionExists,
  deleteSession,
  updateSessionHistoryFields,
  updateSessionPatientProfilePharmacyFields,
} from "@/lib/session-store";
import type { PatientSession } from "@/lib/session-store";
import type { HistoryResponse } from "@/lib/history-schema";
import type { PatientProfile } from "@/lib/interview-schema";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import {
  consumeRateLimit,
  getRequestIp,
  logInvitationAudit,
  markInvitationUsed,
  resolveInvitationFromCookie,
} from "@/lib/invitation-security";

/**
 * GET /api/sessions?code=xxx
 * Get a session by code (for physician to view)
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    status = 400;
    const res = NextResponse.json({ error: "Session code required" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }

  const session = await getSession(code);
  if (!session) {
    status = 404;
    const res = NextResponse.json({ error: "Session not found or expired" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }

  // Ensure transcript is always an array if it exists
  let transcriptToReturn: import("@/lib/interview-schema").InterviewMessage[] | undefined = undefined;
  if (session.transcript) {
    if (Array.isArray(session.transcript)) {
      transcriptToReturn = session.transcript;
    } else {
      logDebug("[api/sessions] Transcript is not an array", {
        transcriptType: typeof session.transcript,
      });
    }
  }

  // Convert Date objects to ISO strings for JSON serialization
  // Ensure transcript is always included (even if empty array or undefined)
  const res = NextResponse.json({
    ...session,
    transcript: transcriptToReturn, // Explicitly include validated transcript
    completedAt: session.completedAt.toISOString(),
    viewedAt: session.viewedAt?.toISOString(),
  });
  logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
  return res;
}

/**
 * POST /api/sessions
 * Create a new session (when patient completes form)
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  try {
    const body = await request.json();
    const {
      physicianId: clientPhysicianId,
      patientEmail: clientPatientEmail,
      patientName: clientPatientName,
      chiefComplaint,
      patientProfile,
      history,
      imageSummary,
      imageUrl,
      imageName,
      duration,
      transcript,
    } = body as {
      physicianId: string;
      patientEmail: string;
      patientName: string;
      chiefComplaint: string;
      patientProfile: PatientProfile;
      history: HistoryResponse;
      imageSummary?: string;
      imageUrl?: string;
      imageName?: string;
      duration?: number;
      transcript?: import("@/lib/interview-schema").InterviewMessage[];
    };

    const invitation = await resolveInvitationFromCookie();
    if (!invitation) {
      status = 401;
      const res = NextResponse.json(
        { error: "Invitation verification is required before saving." },
        { status },
      );
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    const ipAddress = getRequestIp(request.headers);
    const userAgent = request.headers.get("user-agent");
    const submitLimiter = await consumeRateLimit(
      `invite-session-submit:${invitation.invitationId}:${ipAddress}`,
      10,
      600,
    );
    if (!submitLimiter.allowed) {
      status = 429;
      const res = NextResponse.json(
        {
          error: "Too many submission attempts. Please wait and try again.",
          retryAfterSeconds: submitLimiter.retryAfterSeconds,
        },
        { status },
      );
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    if (!chiefComplaint || !patientProfile || !history) {
      status = 400;
      const res = NextResponse.json(
        {
          error: "Missing required fields",
          details: { chiefComplaint: !!chiefComplaint, patientProfile: !!patientProfile, history: !!history },
        },
        { status }
      );
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    if (
      clientPhysicianId?.trim() !== invitation.physicianId ||
      clientPatientEmail?.trim().toLowerCase() !== invitation.patientEmail.toLowerCase() ||
      clientPatientName?.trim() !== invitation.patientName
    ) {
      await logInvitationAudit({
        invitationId: invitation.invitationId,
        eventType: "identity_override_attempt",
        ipAddress,
        userAgent,
        metadata: { route: "/api/sessions" },
      });
    }

    const validatedPhysicianId: string = invitation.physicianId;
    const patientEmail = invitation.patientEmail;
    const patientName = invitation.patientName;
    const sessionCode = generateSessionCode();
    
    // Ensure transcript is an array if provided
    // Validate transcript structure if it exists
    let transcriptToStore: import("@/lib/interview-schema").InterviewMessage[] | undefined = undefined;
    
    if (transcript) {
      if (Array.isArray(transcript) && transcript.length > 0) {
        // Validate each message has required fields
        const invalidMessages = transcript.filter(
          (msg) => !msg.role || !msg.content || (msg.role !== "assistant" && msg.role !== "patient")
        );
        if (invalidMessages.length === 0) {
          transcriptToStore = transcript;
        }
      }
    }
    
    const session: PatientSession = {
      sessionCode,
      patientEmail,
      patientName,
      chiefComplaint,
      patientProfile,
      history,
      completedAt: new Date(),
      physicianId: validatedPhysicianId,
      viewedByPhysician: false,
      imageSummary,
      imageUrl,
      imageName,
      duration,
      transcript: transcriptToStore,
    };
    
    await storeSession(session);

    await markInvitationUsed(invitation.invitationId);
    await logInvitationAudit({
      invitationId: invitation.invitationId,
      eventType: "session_saved",
      ipAddress,
      userAgent,
      metadata: { sessionCode },
    });

    const res = NextResponse.json({
      sessionCode,
      viewUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/physician/view?code=${sessionCode}`,
    });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[api/sessions] Failed to create session", { requestId });
    logDebug("[api/sessions] Error details", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    const res = NextResponse.json(
      { error: "Failed to create session" },
      { status }
    );
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }
}

/**
 * PUT /api/sessions
 * Update physician-editable fields on a session
 */
export async function PUT(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const body = await request.json();
    const {
      sessionCode,
      historySummary,
      historyAssessment,
      historyPlan,
      pharmacyName,
      pharmacyNumber,
      pharmacyAddress,
      pharmacyCity,
      pharmacyPhone,
      pharmacyFax,
    } = (body || {}) as {
      sessionCode?: string;
      historySummary?: string;
      historyAssessment?: string;
      historyPlan?: string[];
      pharmacyName?: string;
      pharmacyNumber?: string;
      pharmacyAddress?: string;
      pharmacyCity?: string;
      pharmacyPhone?: string;
      pharmacyFax?: string;
    };

    if (!sessionCode || typeof sessionCode !== "string") {
      status = 400;
      const res = NextResponse.json({ error: "sessionCode is required" }, { status });
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    const wantsHistoryUpdate =
      historySummary !== undefined ||
      historyAssessment !== undefined ||
      historyPlan !== undefined;
    const wantsPharmacyUpdate =
      pharmacyName !== undefined ||
      pharmacyNumber !== undefined ||
      pharmacyAddress !== undefined ||
      pharmacyCity !== undefined ||
      pharmacyPhone !== undefined ||
      pharmacyFax !== undefined;

    if (!wantsHistoryUpdate && !wantsPharmacyUpdate) {
      status = 400;
      const res = NextResponse.json(
        {
          error:
            "Provide historySummary/historyAssessment/historyPlan and/or pharmacy fields to update.",
        },
        { status }
      );
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    let trimmedSummary = "";
    let trimmedAssessment = "";
    let trimmedPlan: string[] = [];

    if (wantsHistoryUpdate) {
      if (typeof historySummary !== "string") {
        status = 400;
        const res = NextResponse.json({ error: "historySummary must be a string" }, { status });
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
      if (typeof historyAssessment !== "string") {
        status = 400;
        const res = NextResponse.json({ error: "historyAssessment must be a string" }, { status });
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
      if (!Array.isArray(historyPlan)) {
        status = 400;
        const res = NextResponse.json({ error: "historyPlan must be an array of strings" }, { status });
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }

      trimmedSummary = historySummary.trim();
      trimmedAssessment = historyAssessment.trim();
      trimmedPlan = historyPlan
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
      if (trimmedSummary.length < 10 || trimmedSummary.length > 1500) {
        status = 400;
        const res = NextResponse.json(
          { error: "historySummary must be between 10 and 1500 characters" },
          { status }
        );
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
      if (trimmedAssessment.length < 10 || trimmedAssessment.length > 1500) {
        status = 400;
        const res = NextResponse.json(
          { error: "historyAssessment must be between 10 and 1500 characters" },
          { status }
        );
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
      if (trimmedPlan.length < 1 || trimmedPlan.length > 60) {
        status = 400;
        const res = NextResponse.json(
          { error: "historyPlan must contain between 1 and 60 items" },
          { status }
        );
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
    }

    const { getCurrentSession } = await import("@/lib/auth");
    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required" }, { status });
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    if (session.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Only providers can update sessions" }, { status });
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    const patientSession = await getSession(sessionCode);
    if (!patientSession) {
      status = 404;
      const res = NextResponse.json({ error: "Session not found or expired" }, { status });
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    if (patientSession.physicianId !== session.userId) {
      status = 403;
      const res = NextResponse.json({ error: "Access denied" }, { status });
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    if (wantsHistoryUpdate) {
      const updated = await updateSessionHistoryFields(sessionCode, {
        summary: trimmedSummary,
        assessment: trimmedAssessment,
        plan: trimmedPlan,
      });
      if (!updated) {
        status = 404;
        const res = NextResponse.json({ error: "Session not found" }, { status });
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
    }

    const normalizedPharmacy = {
      pharmacyName: typeof pharmacyName === "string" ? pharmacyName.trim() : "",
      pharmacyNumber: typeof pharmacyNumber === "string" ? pharmacyNumber.trim() : "",
      pharmacyAddress: typeof pharmacyAddress === "string" ? pharmacyAddress.trim() : "",
      pharmacyCity: typeof pharmacyCity === "string" ? pharmacyCity.trim() : "",
      pharmacyPhone: typeof pharmacyPhone === "string" ? pharmacyPhone.trim() : "",
      pharmacyFax: typeof pharmacyFax === "string" ? pharmacyFax.trim() : "",
    };
    if (wantsPharmacyUpdate) {
      const updated = await updateSessionPatientProfilePharmacyFields(sessionCode, normalizedPharmacy);
      if (!updated) {
        status = 404;
        const res = NextResponse.json({ error: "Session not found" }, { status });
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
    }

    const res = NextResponse.json({
      success: true,
      historySummary: wantsHistoryUpdate ? trimmedSummary : undefined,
      historyAssessment: wantsHistoryUpdate ? trimmedAssessment : undefined,
      historyPlan: wantsHistoryUpdate ? trimmedPlan : undefined,
      pharmacy: wantsPharmacyUpdate ? normalizedPharmacy : undefined,
    });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    console.error("[api/sessions] Failed to update session", { requestId });
    logDebug("[api/sessions] Update error details", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    const res = NextResponse.json({ error: "Failed to update session" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }
}

/**
 * DELETE /api/sessions?code=xxx
 * Delete a session (after physician has copied data)
 * Verifies that the logged-in physician owns this session
 */
export async function DELETE(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    status = 400;
    const res = NextResponse.json({ error: "Session code required" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }

  // Verify authentication
  const { getCurrentSession } = await import("@/lib/auth");
  const session = await getCurrentSession();
  if (!session) {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }

  // Verify physician owns this session
  const patientSession = await getSession(code);
  if (!patientSession) {
    status = 404;
    const res = NextResponse.json({ error: "Session not found" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }

  // Use userId from UserSession (which is the physicianId for provider users)
  if (patientSession.physicianId !== session.userId) {
    status = 403;
    const res = NextResponse.json({ error: "Access denied" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }

  await deleteSession(code);
  const res = NextResponse.json({ success: true });
  logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
  return res;
}
