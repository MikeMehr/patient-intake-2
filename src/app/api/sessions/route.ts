import { NextResponse } from "next/server";
import {
  generateSessionCode,
  getSession,
  storeSession,
  sessionExists,
  deleteSession,
} from "@/lib/session-store";
import type { PatientSession } from "@/lib/session-store";
import type { HistoryResponse } from "@/lib/history-schema";
import type { PatientProfile } from "@/lib/interview-schema";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

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
      physicianId,
      patientEmail,
      patientName,
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

    if (!physicianId || !patientEmail || !patientName || !chiefComplaint || !patientProfile || !history) {
      status = 400;
      const res = NextResponse.json(
        { error: "Missing required fields", details: { physicianId: !!physicianId, patientEmail: !!patientEmail, patientName: !!patientName, chiefComplaint: !!chiefComplaint, patientProfile: !!patientProfile, history: !!history } },
        { status }
      );
      logRequestMeta("/api/sessions", requestId, status, Date.now() - started);
      return res;
    }

    // TypeScript guard: after validation, we know these are strings
    const validatedPhysicianId: string = physicianId;
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

    // Delete the most recent invitation for this patient/physician (non-blocking)
    (async () => {
      try {
        await query(
          `DELETE FROM patient_invitations
           WHERE id IN (
             SELECT id FROM patient_invitations
             WHERE physician_id = $1 AND patient_email = $2
             ORDER BY sent_at DESC NULLS LAST, created_at DESC NULLS LAST
             LIMIT 1
           )`,
          [validatedPhysicianId, patientEmail],
        );
      } catch (cleanupError) {
        console.error("[api/sessions] Failed to delete invitation after completion", cleanupError);
      }
    })();

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
