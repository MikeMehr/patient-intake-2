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
import type { SessionHistory } from "@/lib/session-store";
import type { PatientProfile } from "@/lib/interview-schema";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getCurrentSession } from "@/lib/auth";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import {
  clearInvitationSummaries,
  consumeRateLimit,
  getRequestIp,
  logInvitationAudit,
  markInvitationUsed,
  resolveInvitationFromCookie,
} from "@/lib/invitation-security";
import { createEncounterFromSession, upsertPatientFromSession } from "@/lib/patient-store";
import {
  canAccessSessionInScope,
  loadSessionAccessScope,
  loadSessionPatientId,
} from "@/lib/session-access";
import { startSessionRetentionCleanup } from "@/lib/session-retention-cleanup";

async function translatePatientTextToEnglish(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const azure = getAzureOpenAIClient();
  const instruction =
    "You are a medical translation assistant. Translate the patient's message into English. " +
    "Return only the English translation. Preserve medical meaning. Keep it concise.";

  const completion = await azure.client.chat.completions.create({
    model: azure.deployment,
    messages: [
      { role: "system", content: instruction },
      { role: "user", content: trimmed },
    ],
    max_completion_tokens: 600,
  });

  return completion.choices?.[0]?.message?.content?.trim() || trimmed;
}

/**
 * GET /api/sessions?code=xxx
 * Get a session by code (for physician to view)
 */
export async function GET(request: Request) {
  startSessionRetentionCleanup();
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

  const authSession = await getCurrentSession();
  if (!authSession) {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }

  const scope = await loadSessionAccessScope(code);
  if (!scope) {
    status = 404;
    const res = NextResponse.json({ error: "Session not found or expired" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }

  if (!canAccessSessionInScope({ viewer: authSession, resource: scope })) {
    status = 403;
    const res = NextResponse.json({ error: "Access denied" }, { status });
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

  let patientId: string | null = null;
  try {
    patientId = await loadSessionPatientId(code);
  } catch {
    patientId = null;
  }

  const ipAddress = getRequestIp(request.headers);
  const userAgent = request.headers.get("user-agent");
  try {
    await logPhysicianPhiAudit({
      physicianId: authSession.userId,
      patientId,
      eventType: "session_viewed",
      ipAddress,
      userAgent,
      metadata: {
        sessionCode: code,
        viewerUserType: authSession.userType,
      },
    });
  } catch {
    // Best-effort audit logging: do not fail a valid access path on sink issues.
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
  startSessionRetentionCleanup();
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
      history: SessionHistory;
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

    const initialHpiUpdatedAt = new Date().toISOString();
    // Best-effort: persist an English translation of the patient's final free-text comment.
    // (Physician view wants English-only, but should still work if translation is unavailable.)
    let historyToStore: SessionHistory = {
      ...history,
      hpiUpdatedAt: initialHpiUpdatedAt,
    };
    try {
      const originalFinal = history?.patientFinalQuestionsComments?.trim() || "";
      const hasEnglish =
        typeof history?.patientFinalQuestionsCommentsEnglish === "string" &&
        history.patientFinalQuestionsCommentsEnglish.trim().length > 0;
      const languageCode = (history?.interviewLanguage || "").trim().toLowerCase();
      const interviewIsEnglish = languageCode.startsWith("en");

      if (originalFinal && !hasEnglish) {
        if (interviewIsEnglish) {
          historyToStore = {
            ...history,
            patientFinalQuestionsCommentsEnglish: originalFinal,
          };
        } else if (process.env.HIPAA_MODE !== "true") {
          const translated = await translatePatientTextToEnglish(originalFinal);
          if (translated.trim()) {
            historyToStore = {
              ...history,
              patientFinalQuestionsCommentsEnglish: translated.trim(),
            };
          }
        }
      }
    } catch (err) {
      // Never block session saving on translation failure.
      console.error("[api/sessions] Final comments translation failed:", err);
      historyToStore = {
        ...history,
        hpiUpdatedAt: initialHpiUpdatedAt,
      };
    }
    
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
      history: historyToStore,
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

    // Best-effort: persist structured chart data for Patient DB.
    // (If this fails, the session is still stored and can be viewed from the session list.)
    let patientId: string | null = null;
    try {
      const upserted = await upsertPatientFromSession({
        physicianId: validatedPhysicianId,
        patientName,
        patientEmail,
        patientProfile,
        oscarDemographicNo: (invitation as any).oscarDemographicNo || null,
      });
      patientId = upserted.patientId;

      await createEncounterFromSession({
        patientId: upserted.patientId,
        physicianId: validatedPhysicianId,
        scope: upserted.scope,
        occurredAt: session.completedAt,
        sessionCode,
        chiefComplaint,
        history: historyToStore,
      });
    } catch (err) {
      console.error("[api/sessions] Failed to upsert patient/encounter from session:", err);
    }

    await markInvitationUsed(invitation.invitationId);
    await clearInvitationSummaries(invitation.invitationId);
    await logInvitationAudit({
      invitationId: invitation.invitationId,
      eventType: "session_saved",
      ipAddress,
      userAgent,
      metadata: { sessionCode },
    });

    const res = NextResponse.json({
      sessionCode,
      patientId,
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
  startSessionRetentionCleanup();
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
      historyPhysicalFindings,
      historyPatientFinalComments,
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
      historyPhysicalFindings?: string[];
      historyPatientFinalComments?: string;
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
      historyPlan !== undefined ||
      historyPhysicalFindings !== undefined ||
      historyPatientFinalComments !== undefined;
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
    let trimmedPhysicalFindings: string[] = [];
    let trimmedPatientFinalComments = "";

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
      if (historyPhysicalFindings !== undefined && !Array.isArray(historyPhysicalFindings)) {
        status = 400;
        const res = NextResponse.json({ error: "historyPhysicalFindings must be an array of strings" }, { status });
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
      if (
        historyPatientFinalComments !== undefined &&
        typeof historyPatientFinalComments !== "string"
      ) {
        status = 400;
        const res = NextResponse.json({ error: "historyPatientFinalComments must be a string" }, { status });
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }

      trimmedSummary = historySummary.trim();
      trimmedAssessment = historyAssessment.trim();
      trimmedPlan = historyPlan
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
      trimmedPhysicalFindings = (historyPhysicalFindings ?? [])
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
      trimmedPatientFinalComments = (historyPatientFinalComments ?? "").trim();
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
      if (trimmedPlan.length > 60) {
        status = 400;
        const res = NextResponse.json(
          { error: "historyPlan must contain at most 60 items" },
          { status }
        );
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
      if (trimmedPhysicalFindings.length > 60) {
        status = 400;
        const res = NextResponse.json(
          { error: "historyPhysicalFindings must contain at most 60 items" },
          { status },
        );
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
      if (trimmedPatientFinalComments.length > 4000) {
        status = 400;
        const res = NextResponse.json(
          { error: "historyPatientFinalComments must be 4000 characters or less" },
          { status },
        );
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
    }

    const session = await getCurrentSession();
    if (!session) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required" }, { status });
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    const scope = await loadSessionAccessScope(sessionCode);
    if (!scope) {
      status = 404;
      const res = NextResponse.json({ error: "Session not found or expired" }, { status });
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    if (!canAccessSessionInScope({ viewer: session, resource: scope })) {
      status = 403;
      const res = NextResponse.json({ error: "Access denied" }, { status });
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    const hpiUpdatedAt = wantsHistoryUpdate ? new Date().toISOString() : "";
    if (wantsHistoryUpdate) {
      const updated = await updateSessionHistoryFields(sessionCode, {
        summary: trimmedSummary,
        assessment: trimmedAssessment,
        plan: trimmedPlan,
        physicalFindings: trimmedPhysicalFindings,
        patientFinalQuestionsComments: trimmedPatientFinalComments,
        hpiUpdatedAt,
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
      historyPhysicalFindings: wantsHistoryUpdate ? trimmedPhysicalFindings : undefined,
      historyPatientFinalComments: wantsHistoryUpdate ? trimmedPatientFinalComments : undefined,
      historyHpiUpdatedAt: wantsHistoryUpdate ? hpiUpdatedAt : undefined,
      pharmacy: wantsPharmacyUpdate ? normalizedPharmacy : undefined,
    });
    try {
      const patientId = await loadSessionPatientId(sessionCode);
      await logPhysicianPhiAudit({
        physicianId: session.userId,
        patientId,
        eventType: "session_updated",
        ipAddress: getRequestIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        metadata: {
          sessionCode,
          viewerUserType: session.userType,
          updatedHistory: wantsHistoryUpdate,
          updatedPharmacy: wantsPharmacyUpdate,
        },
      });
    } catch {
      // Best-effort audit logging.
    }
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
  startSessionRetentionCleanup();
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
  const session = await getCurrentSession();
  if (!session) {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }

  const scope = await loadSessionAccessScope(code);
  if (!scope) {
    status = 404;
    const res = NextResponse.json({ error: "Session not found" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }

  if (!canAccessSessionInScope({ viewer: session, resource: scope })) {
    status = 403;
    const res = NextResponse.json({ error: "Access denied" }, { status });
    logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
    return res;
  }

  await deleteSession(code);
  try {
    const patientId = await loadSessionPatientId(code);
    await logPhysicianPhiAudit({
      physicianId: session.userId,
      patientId,
      eventType: "session_deleted",
      ipAddress: getRequestIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        sessionCode: code,
        viewerUserType: session.userType,
      },
    });
  } catch {
    // Best-effort audit logging.
  }
  const res = NextResponse.json({ success: true });
  logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
  return res;
}
