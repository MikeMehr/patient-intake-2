import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { startInvitationCleanup } from "@/lib/invitations-cleanup";

export const runtime = "nodejs";

type DbTimestamp = string | Date | null;
type ActivityStatus =
  | "sent"
  | "opened"
  | "in_progress"
  | "active_recently"
  | "completed"
  | "expired"
  | "revoked";
const ACTIVE_RECENTLY_WINDOW_MS = 15 * 60 * 1000;

type InvitationRow = {
  id: string;
  patient_name: string;
  patient_email: string;
  sent_at: string | null;
  invitation_link: string;
  used_at: DbTimestamp;
  revoked_at: DbTimestamp;
  token_expires_at: DbTimestamp;
  expires_at: DbTimestamp;
  opened_at: DbTimestamp;
  interview_started_at: DbTimestamp;
  otp_verified_at: DbTimestamp;
  session_saved_at: DbTimestamp;
  invitation_session_created_at: DbTimestamp;
  last_accessed_at: DbTimestamp;
};

function toDate(value: DbTimestamp): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toIso(value: DbTimestamp): string | null {
  const parsed = toDate(value);
  return parsed ? parsed.toISOString() : null;
}

export async function GET() {
  try {
    startInvitationCleanup();

    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (session.userType !== "provider") {
      return NextResponse.json({ error: "Only providers can list invitations" }, { status: 403 });
    }

    const physicianId = (session as any).physicianId || session.userId;
    const result = await query<InvitationRow>(
      `SELECT pi.id,
              pi.patient_name,
              pi.patient_email,
              pi.sent_at,
              pi.invitation_link,
              pi.used_at,
              pi.revoked_at,
              pi.token_expires_at,
              pi.expires_at,
              MAX(CASE WHEN ial.event_type = 'invite_opened' THEN ial.created_at END) AS opened_at,
              MAX(CASE WHEN ial.event_type = 'interview_started' THEN ial.created_at END) AS interview_started_at,
              MAX(CASE WHEN ial.event_type = 'otp_verified' THEN ial.created_at END) AS otp_verified_at,
              MAX(CASE WHEN ial.event_type = 'session_saved' THEN ial.created_at END) AS session_saved_at,
              MAX(isess.created_at) AS invitation_session_created_at,
              MAX(isess.last_accessed_at) AS last_accessed_at
       FROM patient_invitations pi
       LEFT JOIN invitation_audit_log ial
         ON ial.invitation_id = pi.id
        AND ial.event_type IN ('invite_opened', 'interview_started', 'otp_verified', 'session_saved')
       LEFT JOIN invitation_sessions isess
         ON isess.invitation_id = pi.id
       WHERE pi.physician_id = $1
       GROUP BY pi.id, pi.patient_name, pi.patient_email, pi.sent_at, pi.invitation_link, pi.used_at, pi.revoked_at, pi.token_expires_at, pi.expires_at
       ORDER BY pi.sent_at DESC NULLS LAST, pi.patient_name ASC`,
      [physicianId],
    );

    const invitations = result.rows.map((row) => {
      const usedAt = toDate(row.used_at);
      const revokedAt = toDate(row.revoked_at);
      const expiry = toDate(row.token_expires_at) ?? toDate(row.expires_at);
      const expired = Boolean(expiry && expiry.getTime() <= Date.now());
      const openable = !usedAt && !revokedAt && !expired;
      const invalidReason: "used" | "revoked" | "expired" | null =
        revokedAt ? "revoked" : usedAt ? "used" : expired ? "expired" : null;
      const openedAt = toDate(row.opened_at);
      const interviewStartedAt = toDate(row.interview_started_at);
      const otpVerifiedAt = toDate(row.otp_verified_at);
      const sessionSavedAt = toDate(row.session_saved_at);
      const invitationSessionCreatedAt = toDate(row.invitation_session_created_at);
      const lastAccessedAt = toDate(row.last_accessed_at);
      const hasEngaged = Boolean(interviewStartedAt || otpVerifiedAt || invitationSessionCreatedAt);
      const isActiveRecently = Boolean(
        lastAccessedAt && Date.now() - lastAccessedAt.getTime() <= ACTIVE_RECENTLY_WINDOW_MS && hasEngaged,
      );
      const isCompleted = Boolean(usedAt || sessionSavedAt);
      let activityStatus: ActivityStatus = "sent";
      if (revokedAt) activityStatus = "revoked";
      else if (expired) activityStatus = "expired";
      else if (isCompleted) activityStatus = "completed";
      else if (isActiveRecently) activityStatus = "active_recently";
      else if (hasEngaged) activityStatus = "in_progress";
      else if (openedAt) activityStatus = "opened";

      return {
        id: row.id,
        patientName: row.patient_name,
        patientEmail: row.patient_email,
        sentAt: toIso(row.sent_at),
        invitationLink: row.invitation_link,
        openable,
        invalidReason,
        activityStatus,
        openedAt: toIso(row.opened_at),
        interviewStartedAt: toIso(row.interview_started_at),
        otpVerifiedAt: toIso(row.otp_verified_at),
        completedAt: toIso(row.used_at) || toIso(row.session_saved_at),
        invitationSessionCreatedAt: toIso(row.invitation_session_created_at),
        lastAccessedAt: toIso(row.last_accessed_at),
      };
    });

    return NextResponse.json({ invitations });
  } catch (error) {
    console.error("[invitations/list] Error fetching invitations", error);
    return NextResponse.json({ error: "Failed to fetch invitations" }, { status: 500 });
  }
}

