/**
 * Database-backed storage for patient intake sessions.
 * Patient data is temporary - automatically deleted after 24 hours (HIPAA compliance).
 */

import type { HistoryResponse } from "./history-schema";
import type { PatientProfile, InterviewMessage } from "./interview-schema";
import { query } from "./db";

export interface PatientSession {
  sessionCode: string;
  patientEmail: string;
  patientName: string;
  chiefComplaint: string;
  patientProfile: PatientProfile;
  history: HistoryResponse;
  completedAt: Date;
  physicianId: string;
  viewedByPhysician: boolean;
  viewedAt?: Date;
  imageSummary?: string;
  imageUrl?: string;
  imageName?: string;
  duration?: number; // Interview duration in seconds
  transcript?: InterviewMessage[]; // Complete interview transcript (questions and answers)
}

// Clean up expired sessions (older than 24 hours)
const SESSION_EXPIRY_HOURS = Number(process.env.SESSION_EXPIRY_HOURS || 24);

/**
 * Clean up expired sessions from database
 */
export async function cleanupExpiredSessions(): Promise<void> {
  try {
    const result = await query(
      `DELETE FROM patient_sessions
       WHERE created_at < NOW() - INTERVAL '${SESSION_EXPIRY_HOURS} hours'`
    );
    if (process.env.NODE_ENV === "development") {
      console.log(`[session-store] Cleaned up ${result.rowCount} expired sessions`);
    }
  } catch (error) {
    console.error("[session-store] Error cleaning up expired sessions:", error);
  }
}

// Run cleanup every hour
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    cleanupExpiredSessions().catch(console.error);
  }, 60 * 60 * 1000);
}

/**
 * Generate a unique session code
 */
export function generateSessionCode(): string {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

/**
 * Store a completed patient session in database
 */
export async function storeSession(session: PatientSession): Promise<void> {
  await cleanupExpiredSessions();

  try {
    // Store duration in history JSON if provided
    const historyWithDuration = session.duration 
      ? { ...session.history, interviewDuration: session.duration }
      : session.history;

    // Store transcript in history JSON if provided
    // CRITICAL: Only merge if transcript exists AND is a non-empty array
    const historyWithTranscript = (session.transcript && Array.isArray(session.transcript) && session.transcript.length > 0)
      ? { ...historyWithDuration, transcript: session.transcript }
      : historyWithDuration;

    // Serialize JSON with error handling
    let historyJsonString: string;
    try {
      historyJsonString = JSON.stringify(historyWithTranscript);
    } catch (error) {
      console.error("[session-store] ERROR: Failed to serialize history JSON:", {
        sessionCode: session.sessionCode,
        error: error instanceof Error ? error.message : String(error),
        transcriptLength: session.transcript?.length || 0,
      });
      throw new Error("Failed to serialize session history");
    }

    await query(
      `INSERT INTO patient_sessions (
        physician_id, session_code, patient_name, patient_email,
        chief_complaint, patient_profile, history,
        image_summary, image_url, image_name,
        completed_at, viewed_by_physician, viewed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        session.physicianId,
        session.sessionCode,
        session.patientName,
        session.patientEmail,
        session.chiefComplaint,
        JSON.stringify(session.patientProfile),
        historyJsonString,
        session.imageSummary || null,
        session.imageUrl || null,
        session.imageName || null,
        session.completedAt,
        session.viewedByPhysician,
        session.viewedAt || null,
      ]
    );
  } catch (error) {
    console.error("[session-store] Error storing session:", error);
    throw error;
  }
}

/**
 * Get a session by code (excludes expired sessions)
 */
export async function getSession(sessionCode: string): Promise<PatientSession | null> {
  await cleanupExpiredSessions();

  try {
    const result = await query<{
      physician_id: string;
      session_code: string;
      patient_name: string;
      patient_email: string;
      chief_complaint: string;
      patient_profile: any;
      history: any;
      image_summary: string | null;
      image_url: string | null;
      image_name: string | null;
      completed_at: Date;
      viewed_by_physician: boolean;
      viewed_at: Date | null;
    }>(
      `SELECT 
        physician_id, session_code, patient_name, patient_email,
        chief_complaint, patient_profile, history,
        image_summary, image_url, image_name,
        completed_at, viewed_by_physician, viewed_at
       FROM patient_sessions
       WHERE session_code = $1
       AND created_at >= NOW() - INTERVAL '${SESSION_EXPIRY_HOURS} hours'`,
      [sessionCode]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // Mark as viewed if physician accesses it
    if (!row.viewed_by_physician) {
      await query(
        `UPDATE patient_sessions
         SET viewed_by_physician = TRUE, viewed_at = NOW()
         WHERE session_code = $1`,
        [sessionCode]
      );
      row.viewed_by_physician = true;
      row.viewed_at = new Date();
    }

    // PostgreSQL returns JSON as a parsed object, but let's ensure it's properly typed
    const historyData = (row.history as any) as HistoryResponse & { interviewDuration?: number; transcript?: InterviewMessage[] };
    
    // Extract transcript and interviewDuration from historyData
    const { interviewDuration, transcript, ...history } = historyData || {};

    // Ensure transcript is always an array if it exists
    let extractedTranscript: InterviewMessage[] | undefined = undefined;
    if (transcript) {
      if (Array.isArray(transcript)) {
        extractedTranscript = transcript;
      } else if (typeof transcript === 'object' && transcript !== null) {
        // Try to convert object to array if it's structured differently
        console.warn("[session-store] Transcript is not an array, attempting conversion. Skipping unsafe logging.");
        extractedTranscript = undefined;
      }
    }

    return {
      sessionCode: row.session_code,
      patientEmail: row.patient_email,
      patientName: row.patient_name,
      chiefComplaint: row.chief_complaint,
      patientProfile: row.patient_profile as PatientProfile,
      history: history as HistoryResponse,
      completedAt: row.completed_at,
      physicianId: row.physician_id,
      viewedByPhysician: row.viewed_by_physician,
      viewedAt: row.viewed_at || undefined,
      imageSummary: row.image_summary || undefined,
      imageUrl: row.image_url || undefined,
      imageName: row.image_name || undefined,
      duration: interviewDuration,
      transcript: extractedTranscript,
    };
  } catch (error) {
    console.error("[session-store] Error getting session:", error);
    return null;
  }
}

/**
 * Check if a session code exists
 */
export async function sessionExists(sessionCode: string): Promise<boolean> {
  await cleanupExpiredSessions();

  try {
    const result = await query(
      `SELECT 1 FROM patient_sessions
       WHERE session_code = $1
       AND created_at >= NOW() - INTERVAL '${SESSION_EXPIRY_HOURS} hours'`,
      [sessionCode]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error("[session-store] Error checking session:", error);
    return false;
  }
}

/**
 * Check if a patient session already exists by patient email + name (optionally scoped by physician)
 */
export async function patientSessionExists(params: {
  patientEmail: string;
  patientName: string;
  physicianId?: string;
}): Promise<boolean> {
  await cleanupExpiredSessions();
  const { patientEmail, patientName, physicianId } = params;

  if (!patientEmail || !patientName) {
    return false;
  }

  try {
    const normalizedEmail = patientEmail.toLowerCase();
    const normalizedName = patientName.toLowerCase();

    const queryText = physicianId
      ? `SELECT 1 FROM patient_sessions
         WHERE LOWER(patient_email) = $1
           AND LOWER(patient_name) = $2
           AND physician_id = $3
           AND created_at >= NOW() - INTERVAL '${SESSION_EXPIRY_HOURS} hours'
         LIMIT 1`
      : `SELECT 1 FROM patient_sessions
         WHERE LOWER(patient_email) = $1
           AND LOWER(patient_name) = $2
           AND created_at >= NOW() - INTERVAL '${SESSION_EXPIRY_HOURS} hours'
         LIMIT 1`;

    const queryParams = physicianId
      ? [normalizedEmail, normalizedName, physicianId]
      : [normalizedEmail, normalizedName];

    const result = await query(queryText, queryParams);
    return result.rows.length > 0;
  } catch (error) {
    console.error("[session-store] Error checking patient session existence:", error);
    return false;
  }
}

/**
 * Delete a session (after physician has copied data)
 */
export async function deleteSession(sessionCode: string): Promise<void> {
  try {
    await query(
      `DELETE FROM patient_sessions WHERE session_code = $1`,
      [sessionCode]
    );
  } catch (error) {
    console.error("[session-store] Error deleting session:", error);
    throw error;
  }
}

/**
 * Get all sessions for a specific physician
 */
export async function getSessionsByPhysician(physicianId: string): Promise<PatientSession[]> {
  await cleanupExpiredSessions();

  try {
    const result = await query<{
      physician_id: string;
      session_code: string;
      patient_name: string;
      patient_email: string;
      chief_complaint: string;
      patient_profile: any;
      history: any;
      image_summary: string | null;
      image_url: string | null;
      image_name: string | null;
      completed_at: Date;
      viewed_by_physician: boolean;
      viewed_at: Date | null;
    }>(
      `SELECT 
        physician_id, session_code, patient_name, patient_email,
        chief_complaint, patient_profile, history,
        image_summary, image_url, image_name,
        completed_at, viewed_by_physician, viewed_at
       FROM patient_sessions
       WHERE physician_id = $1
       AND created_at >= NOW() - INTERVAL '${SESSION_EXPIRY_HOURS} hours'
       ORDER BY completed_at DESC`,
      [physicianId]
    );

    return result.rows.map((row) => {
      const historyData = row.history as HistoryResponse & { interviewDuration?: number; transcript?: InterviewMessage[] };
      const { interviewDuration, transcript, ...history } = historyData;
      
      // Ensure transcript is always an array if it exists
      let extractedTranscript: InterviewMessage[] | undefined = undefined;
      if (transcript && Array.isArray(transcript)) {
        extractedTranscript = transcript;
      }
      
      return {
        sessionCode: row.session_code,
        patientEmail: row.patient_email,
        patientName: row.patient_name,
        chiefComplaint: row.chief_complaint,
        patientProfile: row.patient_profile as PatientProfile,
        history: history as HistoryResponse,
        completedAt: row.completed_at,
        physicianId: row.physician_id,
        viewedByPhysician: row.viewed_by_physician,
        viewedAt: row.viewed_at || undefined,
        imageSummary: row.image_summary || undefined,
        imageUrl: row.image_url || undefined,
        imageName: row.image_name || undefined,
        duration: interviewDuration,
        transcript: extractedTranscript,
      };
    });
  } catch (error) {
    console.error("[session-store] Error getting sessions by physician:", error);
    return [];
  }
}

/**
 * Get all sessions (for admin/debugging purposes - deprecated, use getSessionsByPhysician instead)
 */
export async function getAllSessions(): Promise<PatientSession[]> {
  await cleanupExpiredSessions();

  try {
    const result = await query<{
      physician_id: string;
      session_code: string;
      patient_name: string;
      patient_email: string;
      chief_complaint: string;
      patient_profile: any;
      history: any;
      image_summary: string | null;
      image_url: string | null;
      image_name: string | null;
      completed_at: Date;
      viewed_by_physician: boolean;
      viewed_at: Date | null;
    }>(
      `SELECT 
        physician_id, session_code, patient_name, patient_email,
        chief_complaint, patient_profile, history,
        image_summary, image_url, image_name,
        completed_at, viewed_by_physician, viewed_at
       FROM patient_sessions
       WHERE created_at >= NOW() - INTERVAL '${SESSION_EXPIRY_HOURS} hours'
       ORDER BY completed_at DESC`
    );

    return result.rows.map((row) => {
      const historyData = row.history as HistoryResponse & { interviewDuration?: number; transcript?: InterviewMessage[] };
      const { interviewDuration, transcript, ...history } = historyData;
      
      // Ensure transcript is always an array if it exists
      let extractedTranscript: InterviewMessage[] | undefined = undefined;
      if (transcript && Array.isArray(transcript)) {
        extractedTranscript = transcript;
      }
      
      return {
        sessionCode: row.session_code,
        patientEmail: row.patient_email,
        patientName: row.patient_name,
        chiefComplaint: row.chief_complaint,
        patientProfile: row.patient_profile as PatientProfile,
        history: history as HistoryResponse,
        completedAt: row.completed_at,
        physicianId: row.physician_id,
        viewedByPhysician: row.viewed_by_physician,
        viewedAt: row.viewed_at || undefined,
        imageSummary: row.image_summary || undefined,
        imageUrl: row.image_url || undefined,
        imageName: row.image_name || undefined,
        duration: interviewDuration,
        transcript: extractedTranscript,
      };
    });
  } catch (error) {
    console.error("[session-store] Error getting all sessions:", error);
    return [];
  }
}
