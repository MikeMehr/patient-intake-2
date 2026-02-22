/**
 * Database-backed storage for patient intake sessions.
 * Patient sessions are retained for a configurable window.
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

/**
 * Clean up expired sessions from database
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const configuredHours = Number(process.env.SESSION_EXPIRY_HOURS);
  const retentionHours =
    Number.isFinite(configuredHours) && configuredHours > 0
      ? configuredHours
      : 24 * 30;

  const result = await query(
    `DELETE FROM patient_sessions
     WHERE completed_at < NOW() - ($1::int * INTERVAL '1 hour')`,
    [Math.floor(retentionHours)],
  );

  return result.rowCount ?? 0;
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
 * Get a session by code.
 */
export async function getSession(sessionCode: string): Promise<PatientSession | null> {
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
       WHERE session_code = $1`,
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
  try {
    const result = await query(
      `SELECT 1 FROM patient_sessions
       WHERE session_code = $1`,
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
         LIMIT 1`
      : `SELECT 1 FROM patient_sessions
         WHERE LOWER(patient_email) = $1
           AND LOWER(patient_name) = $2
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
 * Update physician-editable HPI fields in a session's history JSON.
 */
export async function updateSessionHistoryFields(
  sessionCode: string,
  updates: {
    summary: string;
    assessment: string;
    plan: string[];
  }
): Promise<boolean> {
  try {
    const { summary, assessment, plan } = updates;
    const planJson = JSON.stringify(plan);
    const result = await query(
      `UPDATE patient_sessions
       SET history = jsonb_set(
         jsonb_set(
           jsonb_set(
             COALESCE(history, '{}'::jsonb),
             '{summary}',
             to_jsonb($2::text),
             true
           ),
           '{assessment}',
           to_jsonb($3::text),
           true
         ),
         '{plan}',
         $4::jsonb,
         true
       )
       WHERE session_code = $1`,
      [sessionCode, summary, assessment, planJson]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error("[session-store] Error updating session HPI fields:", error);
    throw error;
  }
}

/**
 * Update pharmacy fields within a session's patient_profile JSONB.
 */
export async function updateSessionPatientProfilePharmacyFields(
  sessionCode: string,
  updates: {
    pharmacyName?: string;
    pharmacyNumber?: string;
    pharmacyAddress?: string;
    pharmacyCity?: string;
    pharmacyPhone?: string;
    pharmacyFax?: string;
  }
): Promise<boolean> {
  try {
    const result = await query(
      `UPDATE patient_sessions
       SET patient_profile = jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 jsonb_set(
                   COALESCE(patient_profile, '{}'::jsonb),
                   '{pharmacyName}',
                   to_jsonb($2::text),
                   true
                 ),
                 '{pharmacyNumber}',
                 to_jsonb($3::text),
                 true
               ),
               '{pharmacyAddress}',
               to_jsonb($4::text),
               true
             ),
             '{pharmacyCity}',
             to_jsonb($5::text),
             true
           ),
           '{pharmacyPhone}',
           to_jsonb($6::text),
           true
         ),
         '{pharmacyFax}',
         to_jsonb($7::text),
         true
       )
       WHERE session_code = $1`,
      [
        sessionCode,
        updates.pharmacyName ?? "",
        updates.pharmacyNumber ?? "",
        updates.pharmacyAddress ?? "",
        updates.pharmacyCity ?? "",
        updates.pharmacyPhone ?? "",
        updates.pharmacyFax ?? "",
      ]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error("[session-store] Error updating patient profile pharmacy fields:", error);
    throw error;
  }
}

/**
 * Persist the English translation of the patient's final questions/comments in history JSONB.
 * This is used to avoid repeated translation calls on the physician view.
 */
export async function updateSessionFinalCommentsEnglish(
  sessionCode: string,
  englishText: string
): Promise<boolean> {
  const trimmed = englishText.trim();
  if (!trimmed) return false;

  try {
    const result = await query(
      `UPDATE patient_sessions
       SET history = jsonb_set(
         COALESCE(history, '{}'::jsonb),
         '{patientFinalQuestionsCommentsEnglish}',
         to_jsonb($2::text),
         true
       )
       WHERE session_code = $1`,
      [sessionCode, trimmed]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error("[session-store] Error updating final comments English:", error);
    throw error;
  }
}

/**
 * Get all sessions for a specific physician
 */
export async function getSessionsByPhysician(physicianId: string): Promise<PatientSession[]> {
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
         AND (history->>'physicianReviewedAt') IS NULL
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

export async function getSessionsByScope(params: {
  organizationId: string | null;
  physicianId: string;
}): Promise<PatientSession[]> {
  const { organizationId, physicianId } = params;
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
        ps.physician_id, ps.session_code, ps.patient_name, ps.patient_email,
        ps.chief_complaint, ps.patient_profile, ps.history,
        ps.image_summary, ps.image_url, ps.image_name,
        ps.completed_at, ps.viewed_by_physician, ps.viewed_at
       FROM patient_sessions ps
       JOIN physicians ph ON ph.id = ps.physician_id
       WHERE (ps.history->>'physicianReviewedAt') IS NULL
         AND (
           (
             $1::uuid IS NOT NULL
             AND ph.organization_id = $1::uuid
           )
           OR
           (
             $1::uuid IS NULL
             AND ph.organization_id IS NULL
             AND ps.physician_id = $2::uuid
           )
         )
       ORDER BY ps.completed_at DESC`,
      [organizationId, physicianId],
    );

    return result.rows.map((row) => {
      const historyData = row.history as HistoryResponse & {
        interviewDuration?: number;
        transcript?: InterviewMessage[];
      };
      const { interviewDuration, transcript, ...history } = historyData;

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
    console.error("[session-store] Error getting sessions by scope:", error);
    return [];
  }
}

/**
 * Get all sessions (for admin/debugging purposes - deprecated, use getSessionsByPhysician instead)
 */
export async function getAllSessions(): Promise<PatientSession[]> {
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
