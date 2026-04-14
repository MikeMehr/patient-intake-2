import {
  interviewRequestSchema,
  interviewResponseSchema,
  type InterviewResponse,
} from "@/lib/interview-schema";
import { mockHistory } from "@/lib/mock-history";
import { NextResponse } from "next/server";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { query } from "@/lib/db";
import { sanitizeAssistiveClinicalText } from "@/lib/clinical-safety";
import {
  consumeRateLimit,
  getRequestIp,
  logInvitationAudit,
  markInvitationUsed,
  resolveInvitationFromCookie,
} from "@/lib/invitation-security";
import {
  applySensitivePhotoSuppressionToTurn,
  attachProgressToTurn,
  getSensitivePhotoContext,
} from "./prompt-helpers";
import { buildPrompt as buildInterviewPrompt } from "./prompt-builder";
import { buildInterviewState } from "./state-builder";
import { summarySystemPrompt } from "./prompt-summary";
import { sendEmergencyAlertSMS } from "@/lib/sms";
import { getPhysicianPhone } from "@/lib/physician-lookup";

function validateInterviewTurnFormat(turn: InterviewResponse): InterviewResponse {
  if (turn.type === "question") {
    return {
      type: "question",
      question: typeof turn.question === "string" && turn.question.trim() ? turn.question.trim() : "Can you tell me more about your concern?",
      rationale: typeof turn.rationale === "string" ? turn.rationale : "Gather patient history.",
      requiresPhotoUpload: turn.requiresPhotoUpload === true,
      requiresLocationMarking: turn.requiresLocationMarking === true,
      ...(turn.locationBodyParts && turn.locationBodyParts.length > 0 && { locationBodyParts: turn.locationBodyParts }),
      deferredIntentHint: turn.deferredIntentHint,
      ...(turn.progress && { progress: turn.progress }),
      ...(turn.newComplaints && turn.newComplaints.length > 0 && { newComplaints: turn.newComplaints }),
    };
  }
  if (turn.type === "summary") {
    return turn;
  }
  return {
    type: "question",
    question: "Can you tell me more about your concern?",
    rationale: "Fallback after invalid response format.",
    requiresPhotoUpload: false,
  };
}

function buildMockTurn(
  chiefComplaint: string,
  forceSummary: boolean,
  state: ReturnType<typeof buildInterviewState>,
): InterviewResponse {
  if (forceSummary) {
    return {
      type: "summary",
      positives: [...mockHistory.positives, ...state.activeHandoffNeeds],
      negatives: mockHistory.negatives,
      physicalFindings: mockHistory.physicalFindings || [],
      summary: `${mockHistory.summary} Active complaint: ${state.activeComplaint}.${state.activeHandoffNeeds.length > 0 ? ` Handoff needs: ${state.activeHandoffNeeds.join("; ")}` : ""}`,
      investigations: mockHistory.investigations,
      assessment: mockHistory.assessment,
      plan: [...mockHistory.plan, ...state.activeHandoffNeeds.map((need) => `Address handoff need: ${need}`)],
    };
  }
  return {
    type: "question",
    question: `Can you tell me more about your ${chiefComplaint || "concern"}?`,
    rationale: "Open narrative to begin history-taking.",
    requiresPhotoUpload: false,
  };
}

const systemInstruction = `
You are a Physician Assistant conducting a medical history. You decide what to ask and when to summarize.

NON-NEGOTIABLE SAFETY RULES:
- Do not provide treatment recommendations, medication instructions, dosing advice, or diagnosis to the patient.
- If the patient corrects or redirects the history, acknowledge it briefly and adapt naturally.
- Do not introduce unrelated complaints on your own.
- If a photo was already reviewed, do not ask for another unless the prompt explicitly requires it.
- Return valid JSON only in the requested schema.
`.trim();

const shouldMock = () =>
  process.env.MOCK_AI === "true" || process.env.NODE_ENV === "test";

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  let payload: Record<string, unknown>;

  try {
    payload = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  logDebug("[interview-route] Payload metadata", {
    keys: Object.keys(payload || {}),
    transcriptLength: Array.isArray((payload as any)?.transcript)
      ? (payload as any).transcript.length
      : undefined,
    hasSummaries: {
      imageSummary: !!(payload as any)?.imageSummary,
      labReportSummary: !!(payload as any)?.labReportSummary,
      previousLabReportSummary: !!(payload as any)?.previousLabReportSummary,
      formSummary: !!(payload as any)?.formSummary,
    },
    hasInterviewGuidance: !!(payload as any)?.interviewGuidance,
  });

  const parsed = interviewRequestSchema.safeParse(payload);
  if (!parsed.success) {
    status = 400;
    console.error("[interview-route] Validation error", { requestId });
    const errorMessages = parsed.error.issues.map((err) => {
      const path = err.path.join(".");
      return path ? `${path}: ${err.message}` : err.message;
    });
    const res = NextResponse.json(
      { 
        error: "Invalid payload.", 
        details: parsed.error.format(),
        message: errorMessages.join("; ")
      },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  const {
    transcript,
    patientProfile,
    patientEmail: clientPatientEmail,
    physicianId: clientPhysicianId,
    chiefComplaint,
    imageSummary,
    formSummary,
    medPmhSummary,
    patientBackground,
    forceSummary = false,
    language: requestedLanguage,
    deferredIntentHint,
    detectedComplaints,
  } = parsed.data;
  
  const supportedLanguages: Record<string, string> = {
    en: "English",
    am: "Amharic",
    ar: "Arabic",
    bn: "Bengali",
    bs: "Bosnian",
    my: "Burmese",
    yue: "Cantonese",
    chr: "Cherokee",
    cr: "Cree",
    hr: "Croatian",
    cs: "Czech",
    nl: "Dutch",
    es: "Spanish",
    fa: "Farsi (Persian)",
    fr: "French",
    de: "German",
    el: "Greek",
    gu: "Gujarati",
    he: "Hebrew",
    hi: "Hindi",
    hu: "Hungarian",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    pt: "Portuguese",
    zh: "Chinese (Simplified)",
  };
  const languageCode =
    requestedLanguage && supportedLanguages[requestedLanguage]
      ? requestedLanguage
      : "en";
  const languageName = supportedLanguages[languageCode] || "English";
  
  // Do not log PHI-containing summaries in production
  
  const lastMessage = transcript.at(-1);
  if (transcript.length > 0 && lastMessage?.role !== "patient" && !forceSummary) {
    status = 422;
    const res = NextResponse.json(
      { error: "Provide a patient response before requesting another turn." },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  const interviewState = buildInterviewState({
    chiefComplaint,
    patientProfile,
    transcript,
    formSummary: formSummary ?? null,
    patientBackground: patientBackground ?? null,
    forceSummary,
    deferredIntentHint: deferredIntentHint ?? null,
    detectedComplaints: detectedComplaints ?? [],
  });

  if (shouldMock()) {
    const mockTurn = buildMockTurn(chiefComplaint, forceSummary, interviewState);
    const res = NextResponse.json(
      attachProgressToTurn(mockTurn, interviewState.progress),
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  const ipAddress = getRequestIp(request.headers);
  const userAgent = request.headers.get("user-agent");
  const invitationContext = await resolveInvitationFromCookie();
  if (!invitationContext) {
    status = 401;
    const res = NextResponse.json(
      { error: "Invitation verification is required." },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  const turnLimiter = await consumeRateLimit(
    `invite-interview:${invitationContext.invitationId}:${ipAddress}`,
    120,
    900,
  );
  if (!turnLimiter.allowed) {
    status = 429;
    const res = NextResponse.json(
      {
        error: "Too many interview requests. Please wait and try again.",
        retryAfterSeconds: turnLimiter.retryAfterSeconds,
      },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  // Only for telemetry: record mismatches when a client attempts identity override.
  if (
    clientPatientEmail?.trim() &&
    clientPatientEmail.trim().toLowerCase() !== invitationContext.patientEmail.toLowerCase()
  ) {
    await logInvitationAudit({
      invitationId: invitationContext.invitationId,
      eventType: "identity_override_attempt",
      ipAddress,
      userAgent,
      metadata: {
        route: "/api/interview",
      },
    });
  }
  if (clientPhysicianId?.trim() && clientPhysicianId.trim() !== invitationContext.physicianId) {
    await logInvitationAudit({
      invitationId: invitationContext.invitationId,
      eventType: "identity_override_attempt",
      ipAddress,
      userAgent,
      metadata: {
        route: "/api/interview",
      },
    });
  }

  // Strict single-use semantics: mark used at first interview turn.
  if (transcript.length === 0) {
    await markInvitationUsed(invitationContext.invitationId);
    await logInvitationAudit({
      invitationId: invitationContext.invitationId,
      eventType: "interview_started",
      ipAddress,
      userAgent,
    });
  }

  // Verify invitation state after session resolution.
  try {
    const invitationCheck = await query(
      `SELECT 1
       FROM patient_invitations
       WHERE id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [invitationContext.invitationId],
    );
    if (invitationCheck.rowCount === 0) {
      status = 403;
      const res = NextResponse.json(
        { error: "You weren’t invited to complete this form." },
        { status },
      );
      logRequestMeta("/api/interview", requestId, status, Date.now() - started);
      return res;
    }
  } catch (err) {
    console.error("[interview-route] Invitation check failed", err);
    // If DB fails, return generic error
    status = 500;
    const res = NextResponse.json(
      { error: "Unable to verify invitation. Please try again later." },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  // Block external AI calls in HIPAA mode
  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      {
        error: "Interview generation is disabled in HIPAA mode (external AI blocked).",
        hipaaMode: true,
      },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    status = 500;
    const res = NextResponse.json(
      { error: (err as Error).message || "Azure OpenAI is not configured." },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const sensitivePhotoContext = getSensitivePhotoContext({
      sex: patientProfile.sex,
      textBlocks: [chiefComplaint, ...transcript.map((message) => message.content)],
    });
    const prompt = buildInterviewPrompt(
      chiefComplaint,
      patientProfile,
      transcript,
      typeof imageSummary === "string" && imageSummary.trim().length > 0
        ? imageSummary.trim()
        : null,
      invitationContext.labReportSummary,
      invitationContext.previousLabReportSummary,
      invitationContext.formSummary,
      (() => {
        const parts = [
          invitationContext.interviewGuidance,
          invitationContext.monitorGuidance
            ? `[PHYSICIAN MONITOR NOTE]: ${invitationContext.monitorGuidance}`
            : null,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join("\n") : null;
      })(),
      typeof medPmhSummary === "string" && medPmhSummary.trim().length > 0
        ? medPmhSummary.trim()
        : null,
      typeof patientBackground === "string" && patientBackground.trim().length > 0
        ? patientBackground.trim()
        : null,
      forceSummary || false,
      languageName,
      deferredIntentHint ?? null,
      sensitivePhotoContext,
      interviewState,
    );

    const languageInstruction = languageName === "English"
      ? `LANGUAGE: Respond in English.`
      : `LANGUAGE: For all patient-facing questions and messages (the conversation), respond ONLY in ${languageName}. Do NOT include English translations or mixed language unless ${languageName} is English. If you cannot reliably produce ${languageName}, fall back to English. Keep summaries/assessment/plan in English for the clinician. Preserve medical accuracy.
PHYSICIAN MONITOR (hidden from patient): When type is "question", also include:
- "question_en": the English translation of the question field (for the physician's live monitor).
- "patient_message_en": the English translation of the patient's most recent message in the transcript (for the physician's live monitor). Omit if there is no patient message yet.
These fields are never shown to the patient.`;

    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: `${systemInstruction}\n\n${summarySystemPrompt}\n\n${languageInstruction}` },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 1200,
    });

    const textPayload = completion.choices?.[0]?.message?.content?.trim() || "";

    const parsedTurn = enforceAssistiveLanguageOnInterviewTurn(parseInterviewTurn(textPayload)) as InterviewResponse;
    // Capture English translations before validateInterviewTurnFormat strips extra fields
    const parsedQuestionEn = (parsedTurn as { question_en?: string }).question_en ?? null;
    const parsedPatientMsgEn = (parsedTurn as { patient_message_en?: string }).patient_message_en ?? null;
    const validatedTurn = validateInterviewTurnFormat(parsedTurn);
    const finalTurn = applySensitivePhotoSuppressionToTurn(validatedTurn, sensitivePhotoContext);
    const turnWithProgress = attachProgressToTurn(finalTurn, interviewState.progress);

    // Send emergency SMS alert if the LLM flagged this as a genuine emergency
    console.error(`[SMS-DEBUG] turn type=${turnWithProgress.type} isEmergency=${turnWithProgress.type === "summary" ? (turnWithProgress as { isEmergency?: boolean }).isEmergency : "n/a"}`);
    if (turnWithProgress.type === "summary" && (turnWithProgress as { isEmergency?: boolean }).isEmergency === true) {
      // Fire-and-forget: send SMS asynchronously without blocking response
      (async () => {
        try {
          const physicianPhone = await getPhysicianPhone(invitationContext.physicianId);
          console.error(`[SMS-DEBUG] physicianId=${invitationContext.physicianId} phone=${physicianPhone ? "present" : "MISSING"}`);

          if (!physicianPhone) {
            logDebug("[interview-route] Physician has no phone number for SMS alert", {
              physicianId: invitationContext.physicianId,
            });
            return;
          }

          // Construct patient dashboard URL
          const patientName = invitationContext.patientName || "Patient";
          const patientRecordUrl = `https://mymd.health-assist.org/auth/login`;

          console.error(`[SMS-DEBUG] Sending SMS to physician for patient=${patientName}`);

          const result = await sendEmergencyAlertSMS(
            physicianPhone,
            patientName,
            patientRecordUrl
          );

          console.error(`[SMS-DEBUG] SMS result: success=${result.success} sid=${result.messageSid} error=${result.error}`);

          if (!result.success) {
            logDebug("[interview-route] Emergency SMS send failed", {
              error: result.error,
              physicianId: invitationContext.physicianId,
            });
          }
        } catch (smsError) {
          // Log SMS errors but don't interrupt interview response
          const errorMsg = smsError instanceof Error ? smsError.message : String(smsError);
          console.error(`[SMS-DEBUG] Exception: ${errorMsg}`);
          logDebug("[interview-route] Unexpected error sending emergency SMS", {
            error: errorMsg,
          });
        }
      })();
    }

    // Fire-and-forget: persist live turn data for physician monitor window (no extra LLM call)
    if (invitationContext.invitationId) {
      (async () => {
        try {
          // If this is a fresh interview start (transcript is empty before the AI's first response),
          // delete all previous live turns so the monitor shows only the new session.
          if (transcript.length === 0) {
            await query(
              `DELETE FROM interview_live_turns WHERE invitation_id = $1`,
              [invitationContext.invitationId],
            );
          }

          // Derive turn indices deterministically from transcript position (prevents race-condition
          // duplicates that occurred when two concurrent calls both read the same MAX(turn_index)).
          // transcript already includes the patient's latest message as its last entry.
          // Patient turn = its 0-based position in the transcript; assistant turn = immediately after.
          const lastMsg = transcript[transcript.length - 1];
          const patientTurnIdx = transcript.length - 1; // -1 when transcript is empty (no patient msg)
          const assistantTurnIdx = transcript.length;   // 0 when transcript is empty (first AI turn)

          // Build state snapshot from interviewState (zero extra LLM cost)
          const isSum = turnWithProgress.type === "summary";
          const questionText = !isSum ? (turnWithProgress as { question?: string }).question ?? null : null;
          // Use pre-captured values since validateInterviewTurnFormat strips question_en/patient_message_en
          const questionTextEn = !isSum ? parsedQuestionEn : null;
          const patientMsgEn = !isSum ? parsedPatientMsgEn : null;
          const rationaleText = !isSum ? (turnWithProgress as { rationale?: string }).rationale ?? null : null;

          // Insert patient's last message if present
          // patientMsgEn (English translation) is stored in the rationale column for patient turns
          // since rationale is unused for patient rows.
          if (lastMsg?.role === "patient") {
            await query(
              `INSERT INTO interview_live_turns (invitation_id, turn_index, role, content, rationale)
               VALUES ($1, $2, 'patient', $3, $4) ON CONFLICT DO NOTHING`,
              [invitationContext.invitationId, patientTurnIdx, lastMsg.content, patientMsgEn],
            );
          }
          // For non-English interviews, state-builder topic matching is English-only so
          // activeComplaintIndex may not advance even when the AI has moved on. Use the
          // English translation of the current question to detect complaint transitions.
          const snapshotActiveComplaint = (() => {
            const baseComplaint = interviewState.activeComplaint ?? null;
            if (!questionTextEn) return baseComplaint;
            const pending = interviewState.pendingComplaints ?? [];
            const lowerQ = questionTextEn.toLowerCase();
            const match = pending.find((c) => lowerQ.includes(c.toLowerCase()));
            return match ?? baseComplaint;
          })();

          // When activeComplaint is overridden to a pending complaint, update roadmap lists
          const overrodeComplaint = snapshotActiveComplaint !== (interviewState.activeComplaint ?? null);
          const snapshotPendingComplaints = overrodeComplaint
            ? (interviewState.pendingComplaints ?? []).filter((c) => c !== snapshotActiveComplaint)
            : (interviewState.pendingComplaints ?? []);
          const snapshotCompletedComplaints = overrodeComplaint
            ? [...(interviewState.completedComplaints ?? []), interviewState.activeComplaint].filter(Boolean) as string[]
            : (interviewState.completedComplaints ?? []);

          const stateSnap = {
            patientSex: patientProfile.sex ?? null,
            patientAge: patientProfile.age ?? null,
            chiefComplaint: interviewState.chiefComplaint ?? chiefComplaint ?? null,
            activeComplaint: snapshotActiveComplaint,
            complaintClass: interviewState.complaintClass ?? null,
            protocolId: (interviewState.protocol as { id?: string })?.id ?? null,
            complaints: interviewState.complaints ?? [],
            pendingComplaints: snapshotPendingComplaints,
            completedComplaints: snapshotCompletedComplaints,
            missingRequiredFields: (interviewState.missingRequiredFields ?? []).map((f: { label?: string }) => f.label ?? String(f)),
            missingRedFlags: (interviewState.missingRedFlags ?? []).map((f: { label?: string }) => f.label ?? String(f)),
            activeCoveredTopics: interviewState.activeCoveredTopics ?? [],
            urgency: interviewState.urgency ?? "routine",
            escalationReasons: interviewState.escalationReasons ?? [],
            historyConfidence: interviewState.historyConfidence ?? "clear",
            summaryReady: interviewState.summaryReady ?? false,
            earlyStopReason: interviewState.earlyStopReason ?? null,
            deferredIntentHint: interviewState.deferredIntentHint ?? null,
            questionsAsked: interviewState.progress?.questionsAsked ?? interviewState.totalQuestionCount ?? 0,
            totalQuestionCount: interviewState.progress?.approxTotalQuestions ?? interviewState.totalQuestionCount ?? null,
            // Store English translation of question for physician monitor (no schema migration needed)
            contentEn: questionTextEn ?? undefined,
          };

          await query(
            `INSERT INTO interview_live_turns
               (invitation_id, turn_index, role, content, rationale, state_snapshot, is_summary)
             VALUES ($1, $2, 'assistant', $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
            [invitationContext.invitationId, assistantTurnIdx, questionText ?? "[summary]", rationaleText, JSON.stringify(stateSnap), isSum],
          );
        } catch {
          // Silent — monitor data is best-effort, must not affect patient interview
        }
      })();
    }

    // Fire-and-forget: clear one-shot monitor guidance after it has been used
    if (invitationContext.monitorGuidance && invitationContext.invitationId) {
      (async () => {
        try {
          await query(
            `UPDATE patient_invitations SET monitor_guidance = NULL WHERE id = $1`,
            [invitationContext.invitationId],
          );
        } catch {
          // Silent
        }
      })();
    }

    const res = NextResponse.json({ ...turnWithProgress, requestPhqGad: invitationContext.requestPhqGad ?? false });
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    status = 502;
    console.error("[interview-route] Azure OpenAI error", { requestId });
    
    // Check for quota/rate limit errors
    const errorText = errorMessage.toLowerCase();
    const isQuotaError = errorText.includes("quota") || 
      errorText.includes("rate limit") ||
      errorText.includes("429") ||
      errorText.includes("too many requests");
    
    // Provide more detailed error information in development
    const errorDetails = process.env.NODE_ENV === "development" 
      ? {
          message: errorMessage,
          stack: errorStack,
          transcriptLength: transcript.length,
        }
      : undefined;
    
    const statusCode = isQuotaError ? 429 : 502;
    status = statusCode;
    const userMessage = isQuotaError
      ? "The AI service has reached its daily request limit. Please try again later or contact your physician for assistance."
      : "Unable to continue the interview right now.";
    
    const res = NextResponse.json(
      { 
        error: userMessage,
        message: errorMessage,
        details: errorDetails
      },
      { status: statusCode },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }
}

function enforceAssistiveLanguageOnInterviewTurn(turn: unknown) {
  if (!turn || typeof turn !== "object") return turn;
  const candidate = turn as Record<string, unknown>;
  if (candidate.type === "question") {
    const next = { ...candidate };
    if (typeof next.question === "string") {
      next.question = sanitizeAssistiveClinicalText(next.question).text;
    }
    if (typeof next.rationale === "string") {
      next.rationale = sanitizeAssistiveClinicalText(next.rationale).text;
    }
    return next;
  }
  if (candidate.type === "summary") {
    const next = { ...candidate };
    if (typeof next.summary === "string") {
      next.summary = sanitizeAssistiveClinicalText(next.summary).text;
    }
    if (typeof next.assessment === "string") {
      next.assessment = sanitizeAssistiveClinicalText(next.assessment).text;
    }
    if (Array.isArray(next.plan)) {
      next.plan = next.plan.map((item) =>
        typeof item === "string" ? sanitizeAssistiveClinicalText(item).text : item,
      );
    }
    if (Array.isArray(next.investigations)) {
      next.investigations = next.investigations.map((item) =>
        typeof item === "string" ? sanitizeAssistiveClinicalText(item).text : item,
      );
    }
    return next;
  }
  return turn;
}

function parseInterviewTurn(payload: string) {
  // Try to extract JSON from markdown code blocks if present
  let jsonText = payload.trim();
  const jsonMatch = payload.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }

  // Try to find JSON object in the text if it's not already extracted
  if (!jsonText.startsWith("{")) {
    const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      jsonText = jsonObjectMatch[0];
    }
  }

  // Clean up common JSON issues
  jsonText = jsonText
    // Remove trailing commas before closing braces/brackets
    .replace(/,(\s*[}\]])/g, '$1')
    // Remove comments (single line)
    .replace(/\/\/.*$/gm, '')
    // Remove comments (multi-line)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Remove any control characters except newlines and tabs (which might be in strings)
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (parseError) {
    console.error("[interview-route] JSON parse error");
    logDebug("[interview-route] JSON parse error details", {
      errorMessage: parseError instanceof Error ? parseError.message : String(parseError),
      payloadKeys: payload ? Object.keys(payload) : [],
      jsonTextLength: jsonText.length,
    });
    
    // Try to fix common JSON issues and retry
    try {
      // Try removing any text before the first {
      const firstBrace = jsonText.indexOf('{');
      if (firstBrace > 0) {
        jsonText = jsonText.substring(firstBrace);
      }
      
      // Try removing any text after the last }
      const lastBrace = jsonText.lastIndexOf('}');
      if (lastBrace > 0 && lastBrace < jsonText.length - 1) {
        jsonText = jsonText.substring(0, lastBrace + 1);
      }
      
      // Additional cleanup attempts - be conservative
      // Remove any remaining trailing commas
      jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
      
      // Try to fix unescaped newlines and quotes in strings by finding string boundaries
      let result = '';
      let inString = false;
      let escapeNext = false;
      
      for (let i = 0; i < jsonText.length; i++) {
        const char = jsonText[i];
        
        if (escapeNext) {
          result += char;
          escapeNext = false;
          continue;
        }
        
        if (char === '\\') {
          result += char;
          escapeNext = true;
          continue;
        }
        
        if (char === '"') {
          inString = !inString;
          result += char;
          continue;
        }
        
        if (inString) {
          // Inside a string - handle special characters
          if (char === '\n' || char === '\r') {
            // Replace newlines in strings with space
            result += ' ';
            continue;
          }
        }
        
        result += char;
      }
      
      jsonText = result;
      
      // Fix missing commas between properties
      // Look for patterns like: "key":"value""key2" or }"key"
      jsonText = jsonText.replace(/(")\s*:\s*("[^"]*")\s*("[^"]*"\s*:)/g, '$1$2,$3');
      // Fix missing commas after closing braces/brackets before property names
      jsonText = jsonText.replace(/([\]}])\s*(")/g, '$1,$2');
      
      // Fix double quotes that might have been created
      jsonText = jsonText.replace(/""/g, '"');
      
      // Remove any duplicate commas
      jsonText = jsonText.replace(/,\s*,/g, ',');
      
      parsed = JSON.parse(jsonText);
      logDebug("[interview-route] Successfully parsed after cleanup");
    } catch (retryError) {
      // Log the problematic JSON for debugging
      console.error("[interview-route] Failed to parse even after cleanup.");
      logDebug("[interview-route] Cleanup parse error details", {
        errorMessage: retryError instanceof Error ? retryError.message : String(retryError),
        jsonTextLength: jsonText.length,
      });
      
      // Try one more time with a more aggressive approach - extract just the JSON structure
      try {
        // Find the first complete JSON object
        let braceCount = 0;
        let startIdx = -1;
        let endIdx = -1;
        
        for (let i = 0; i < jsonText.length; i++) {
          if (jsonText[i] === '{') {
            if (startIdx === -1) startIdx = i;
            braceCount++;
          } else if (jsonText[i] === '}') {
            braceCount--;
            if (braceCount === 0 && startIdx !== -1) {
              endIdx = i;
              break;
            }
          }
        }
        
        if (startIdx !== -1 && endIdx !== -1) {
          let extractedJson = jsonText.substring(startIdx, endIdx + 1);
          
          // Apply one more round of fixes to the extracted JSON
          extractedJson = extractedJson
            .replace(/,(\s*[\]}])/g, '$1') // Remove trailing commas
            .replace(/([\]}])\s*(")/g, '$1,$2') // Add missing commas
            .replace(/,\s*,/g, ','); // Remove duplicate commas
          
          parsed = JSON.parse(extractedJson);
          console.log("[interview-route] Successfully parsed after extracting JSON object");
        } else {
          throw retryError;
        }
      } catch (finalError) {
        // Log the exact position where the error occurred for debugging
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        const positionMatch = errorMsg.match(/position (\d+)/);
        if (positionMatch) {
          const pos = parseInt(positionMatch[1]);
          console.error("[interview-route] Error at position:", pos);
          logDebug("[interview-route] Context around error metadata", {
            jsonTextLength: jsonText.length,
          });
        }
        throw new Error(`Azure OpenAI returned invalid JSON: ${errorMsg}. Please try again.`);
      }
    }
  }

  const result = interviewResponseSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[interview-route] Schema validation error");
    logDebug("[interview-route] Schema validation error details", {
      issues: result.error.issues?.length ?? "unknown",
    });
    
    // Try to fix common issues - truncate fields that are too long
    if (typeof parsed === "object" && parsed !== null) {
      const fixed: any = { ...parsed };
      
      // Truncate question if too long
      if (fixed.type === "question" && typeof fixed.question === "string" && fixed.question.length > 240) {
        logDebug("[interview-route] Truncating long question", { length: fixed.question.length });
        fixed.question = fixed.question.substring(0, 237) + "...";
      }
      
      // Truncate rationale if too long
      if (fixed.type === "question" && typeof fixed.rationale === "string" && fixed.rationale.length > 280) {
        logDebug("[interview-route] Truncating long rationale", { length: fixed.rationale.length });
        fixed.rationale = fixed.rationale.substring(0, 277) + "...";
      }

      // Truncate locationBodyParts if too many items (max 4)
      if (fixed.type === "question" && Array.isArray(fixed.locationBodyParts) && fixed.locationBodyParts.length > 4) {
        logDebug("[interview-route] Truncating long locationBodyParts", { length: fixed.locationBodyParts.length });
        fixed.locationBodyParts = fixed.locationBodyParts.slice(0, 4);
      }
      
      // Truncate summary fields if too long
      if (fixed.type === "summary") {
        const maxLengths: Record<string, number> = {
          summary: 1500,
          assessment: 1500,
        };
        
        for (const [field, maxLen] of Object.entries(maxLengths)) {
          if (typeof fixed[field] === "string" && fixed[field].length > maxLen) {
            logDebug("[interview-route] Truncating long summary field", { field, length: fixed[field].length, maxLen });
            fixed[field] = fixed[field].substring(0, maxLen - 3) + "...";
          }
        }
        
        // Truncate arrays that are too long
        const arrayMaxLengths: Record<string, number> = {
          positives: 6,
          negatives: 6,
          physicalFindings: 6,
          investigations: 6,
          plan: 6,
        };
        
        for (const [field, maxLen] of Object.entries(arrayMaxLengths)) {
          if (Array.isArray(fixed[field]) && fixed[field].length > maxLen) {
            logDebug("[interview-route] Truncating long array field", { field, length: fixed[field].length, maxLen });
            fixed[field] = fixed[field].slice(0, maxLen);
          }
        }

        // Normalize empty required arrays for strict schema compatibility.
        if (!Array.isArray(fixed.positives) || fixed.positives.length === 0) {
          fixed.positives = ["Patient-reported symptoms documented in summary."];
        }
        if (!Array.isArray(fixed.negatives) || fixed.negatives.length === 0) {
          fixed.negatives = ["No additional pertinent negatives documented."];
        }
        if (!Array.isArray(fixed.plan) || fixed.plan.length === 0) {
          fixed.plan = ["Physician review and finalize management plan."];
        }
      }
      
      // Try parsing again with fixed data
      const retryResult = interviewResponseSchema.safeParse(fixed);
      if (retryResult.success) {
        console.log("[interview-route] Successfully fixed validation errors by truncating long fields");
        return retryResult.data;
      }
    }
    
    throw new Error(`Azure OpenAI returned data that does not match the schema: ${result.error.issues.map(i => i.message).join(", ")}`);
  }

  return result.data;
}

