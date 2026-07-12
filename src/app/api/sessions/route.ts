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
import { getAzureSoapClient } from "@/lib/azure-openai";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
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
import { query } from "@/lib/db";
import { decryptString } from "@/lib/encrypted-field";
import { createOscarDemographic } from "@/lib/oscar/self-serve";
import { sendInterviewCompleteSMS } from "@/lib/sms";
import { getPhysicianPhone } from "@/lib/physician-lookup";

/**
 * For a self-serve guided-interview invitation with a NEW patient, create the
 * OSCAR chart now that the interview is finished (this runs on both normal
 * completion and an early "End interview"). Returns the resulting demographicNo,
 * or null when there is nothing to do / creation failed.
 *
 * An atomic sentinel claim on oscar_demographic_no prevents duplicate charts on
 * refresh / double-submit.
 */
async function maybeCreateSelfServeOscarChart(invitationId: string): Promise<string | null> {
  const inv = await query<{
    is_self_serve: boolean;
    oscar_demographic_no: string | null;
    pending_oscar_demographics: Record<string, unknown> | null;
    physician_id: string;
    patient_name: string;
    patient_phone: string | null;
    patient_dob: string | null;
  }>(
    `SELECT is_self_serve, oscar_demographic_no, pending_oscar_demographics,
            physician_id, patient_name, patient_phone, patient_dob::TEXT AS patient_dob
     FROM patient_invitations WHERE id = $1 LIMIT 1`,
    [invitationId],
  );
  const row = inv.rows[0];
  if (
    !row ||
    !row.is_self_serve ||
    row.oscar_demographic_no ||
    !row.pending_oscar_demographics
  ) {
    return null;
  }

  // Atomic claim: only one request proceeds to create the chart.
  const claim = await query<{ id: string }>(
    `UPDATE patient_invitations
     SET oscar_demographic_no = 'PENDING'
     WHERE id = $1 AND oscar_demographic_no IS NULL
     RETURNING id`,
    [invitationId],
  );
  if (claim.rowCount === 0) return null; // someone else claimed it

  try {
    const org = await query<{ organization_id: string | null }>(
      `SELECT organization_id FROM physicians WHERE id = $1 LIMIT 1`,
      [row.physician_id],
    );
    const orgId = org.rows[0]?.organization_id ?? null;
    if (!orgId) throw new Error("Physician has no organization; cannot create OSCAR chart.");

    const demo = row.pending_oscar_demographics as Record<string, unknown>;
    const nameParts = String(row.patient_name || "").trim().replace(/\s+/g, " ").split(" ");
    const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : nameParts[0] || "";
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

    let healthCard: string | null = null;
    if (typeof demo.healthCardEnc === "string" && demo.healthCardEnc) {
      try {
        healthCard = decryptString(demo.healthCardEnc);
      } catch {
        healthCard = null;
      }
    }

    const result = await createOscarDemographic(orgId, {
      firstName,
      lastName,
      dateOfBirth: row.patient_dob || "",
      phone: row.patient_phone || "",
      address: String(demo.address ?? ""),
      city: String(demo.city ?? ""),
      province: String(demo.province ?? ""),
      postal: String(demo.postal ?? ""),
      gender: typeof demo.gender === "string" ? demo.gender : null,
      // PHN → OSCAR `hin`; issuing province defaults to the address province.
      healthCardNumber: healthCard,
      healthCardProvince: healthCard ? String(demo.province ?? "") : null,
      healthCardVersion: healthCard && typeof demo.healthCardVersion === "string" ? demo.healthCardVersion : null,
    });

    if ("error" in result) throw new Error(`OSCAR create failed: ${result.error}`);

    await query(
      `UPDATE patient_invitations
       SET oscar_demographic_no = $1, pending_oscar_demographics = NULL
       WHERE id = $2`,
      [result.demographicNo, invitationId],
    );
    return result.demographicNo;
  } catch (err) {
    // Roll back the sentinel so it can be retried / reconciled manually.
    await query(
      `UPDATE patient_invitations
       SET oscar_demographic_no = NULL
       WHERE id = $1 AND oscar_demographic_no = 'PENDING'`,
      [invitationId],
    ).catch(() => {});
    console.error("[api/sessions] Self-serve OSCAR chart creation failed:", err);
    return null;
  }
}

async function translatePatientTextToEnglish(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const azure = getAzureSoapClient();
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

  return completion.choices?.[0]?.message?.content?.trim() || "";
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
      isEmergency,
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
      isEmergency?: boolean;
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

    // In forms-only mode the patient skips the interview so chiefComplaint is empty.
    const effectiveChiefComplaint = chiefComplaint || (history ? "Forms only" : "");
    if (!effectiveChiefComplaint || !patientProfile || !history) {
      status = 400;
      const res = NextResponse.json(
        {
          error: "Missing required fields",
          details: { chiefComplaint: !!effectiveChiefComplaint, patientProfile: !!patientProfile, history: !!history },
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
      // Also translate chief complaint to English for physician display.
      const chiefComplaintOriginal = chiefComplaint?.trim() || "";
      const hasEnglishCC =
        typeof historyToStore.chiefComplaintEnglish === "string" &&
        historyToStore.chiefComplaintEnglish.trim().length > 0;
      if (chiefComplaintOriginal && !hasEnglishCC) {
        if (interviewIsEnglish) {
          historyToStore = { ...historyToStore, chiefComplaintEnglish: chiefComplaintOriginal };
        } else if (process.env.HIPAA_MODE !== "true") {
          const translatedCC = await translatePatientTextToEnglish(chiefComplaintOriginal);
          if (translatedCC.trim()) {
            historyToStore = { ...historyToStore, chiefComplaintEnglish: translatedCC.trim() };
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

    // Enrich transcript with English translations already stored in interview_live_turns.
    // This reuses translations generated at interview time — no extra LLM calls needed.
    if (transcriptToStore && transcriptToStore.length > 0 && invitation.invitationId) {
      try {
        const turnsResult = await query<{
          role: string;
          content: string;
          rationale: string | null;
          state_snapshot: Record<string, unknown> | null;
        }>(
          `SELECT role, content, rationale, state_snapshot
           FROM interview_live_turns
           WHERE invitation_id = $1
           ORDER BY turn_index ASC`,
          [invitation.invitationId],
        );

        // Build ordered lists of English translations per role
        const assistantEnMap: Map<string, string> = new Map();
        const patientEnMap: Map<string, string> = new Map();
        for (const row of turnsResult.rows) {
          if (row.role === "assistant" && row.state_snapshot) {
            const snap = row.state_snapshot as Record<string, unknown>;
            const contentEn = typeof snap.contentEn === "string" ? snap.contentEn : null;
            if (contentEn) assistantEnMap.set(row.content, contentEn);
          } else if (row.role === "patient" && row.rationale) {
            patientEnMap.set(row.content, row.rationale);
          }
        }

        transcriptToStore = transcriptToStore.map((msg) => {
          const contentEn =
            msg.role === "assistant"
              ? (assistantEnMap.get(msg.content) ?? null)
              : (patientEnMap.get(msg.content) ?? null);
          if (contentEn) return { ...msg, content_en: contentEn };
          return msg;
        }) as import("@/lib/interview-schema").InterviewMessage[];
      } catch {
        // Best-effort: don't block session saving if enrichment fails
      }
    }
    
    const session: PatientSession = {
      sessionCode,
      patientEmail,
      patientName,
      chiefComplaint: effectiveChiefComplaint,
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

    if (process.env.NODE_ENV === "development") {
      const bodyDiagram = historyToStore?.patientUploads?.bodyDiagram;
      logDebug("[api/sessions] bodyDiagram payload summary", {
        selectedParts: Array.isArray(bodyDiagram?.selectedParts) ? bodyDiagram.selectedParts.length : 0,
        markersByPart: Array.isArray(bodyDiagram?.markersByPart) ? bodyDiagram.markersByPart.length : 0,
        leftSoleMarkers: Array.isArray(bodyDiagram?.leftSoleMarkers) ? bodyDiagram.leftSoleMarkers.length : 0,
      });
    }
    
    await storeSession(session);

    const viewUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/physician/view?code=${sessionCode}`;

    // Fire-and-forget: text the physician that a patient finished the guided
    // interview so they can review and call the patient back. Best-effort — the
    // session is already saved, so a failed/absent SMS never blocks completion.
    // Skipped for emergencies: an urgent alert SMS was already sent the moment
    // the summary was generated (see api/interview), so this would be redundant.
    if (isEmergency === true) {
      logDebug("[api/sessions] Skipping interview-complete SMS (emergency already alerted)", {
        physicianId: validatedPhysicianId,
      });
    } else {
      (async () => {
      try {
        const physicianPhone = await getPhysicianPhone(validatedPhysicianId);
        if (!physicianPhone) {
          logDebug("[api/sessions] Physician has no phone for interview-complete SMS", {
            physicianId: validatedPhysicianId,
          });
          return;
        }
        const result = await sendInterviewCompleteSMS(physicianPhone, {
          patientName: patientName || "A patient",
          reviewUrl: viewUrl,
        });
        if (!result.success) {
          logDebug("[api/sessions] Interview-complete SMS send failed", {
            error: result.error,
            physicianId: validatedPhysicianId,
          });
        }
      } catch (smsError) {
        logDebug("[api/sessions] Unexpected error sending interview-complete SMS", {
          error: smsError instanceof Error ? smsError.message : String(smsError),
        });
      }
      })();
    }

    // Self-serve new patients: create the OSCAR chart now that the interview is
    // finished (normal completion OR early "End interview"). No-op for invited
    // flows and for existing patients (who already have oscar_demographic_no).
    let resolvedOscarDemographicNo: string | null =
      (invitation as any).oscarDemographicNo || null;
    try {
      const createdDemographicNo = await maybeCreateSelfServeOscarChart(invitation.invitationId);
      if (createdDemographicNo) resolvedOscarDemographicNo = createdDemographicNo;
    } catch (err) {
      // Never block session saving on OSCAR chart creation.
      console.error("[api/sessions] maybeCreateSelfServeOscarChart threw:", err);
    }

    // Best-effort: persist structured chart data for Patient DB.
    // (If this fails, the session is still stored and can be viewed from the session list.)
    let patientId: string | null = null;
    try {
      const upserted = await upsertPatientFromSession({
        physicianId: validatedPhysicianId,
        patientName,
        patientEmail,
        patientProfile,
        oscarDemographicNo: resolvedOscarDemographicNo,
      });
      patientId = upserted.patientId;

      await createEncounterFromSession({
        patientId: upserted.patientId,
        physicianId: validatedPhysicianId,
        scope: upserted.scope,
        occurredAt: session.completedAt,
        sessionCode,
        chiefComplaint: effectiveChiefComplaint,
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
      viewUrl,
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
      historyInvestigations,
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
      historyInvestigations?: string[];
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
    let trimmedInvestigations: string[] = [];
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
      if (historyInvestigations !== undefined && !Array.isArray(historyInvestigations)) {
        status = 400;
        const res = NextResponse.json({ error: "historyInvestigations must be an array of strings" }, { status });
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
      trimmedInvestigations = (historyInvestigations ?? [])
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
      trimmedPatientFinalComments = (historyPatientFinalComments ?? "").trim();
      if (trimmedSummary.length < 10 || trimmedSummary.length > 3000) {
        status = 400;
        const res = NextResponse.json(
          { error: "historySummary must be between 10 and 3000 characters" },
          { status }
        );
        logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
        return res;
      }
      if (trimmedAssessment.length < 10 || trimmedAssessment.length > 3000) {
        status = 400;
        const res = NextResponse.json(
          { error: "historyAssessment must be between 10 and 3000 characters" },
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
        investigations: trimmedInvestigations,
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
        physicianId: getEffectivePhysicianId(session),
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
