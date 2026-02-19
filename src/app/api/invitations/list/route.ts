import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { startInvitationCleanup } from "@/lib/invitations-cleanup";

export const runtime = "nodejs";

type DbTimestamp = string | Date | null;

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
};

function toDate(value: DbTimestamp): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
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
      `SELECT id,
              patient_name,
              patient_email,
              sent_at,
              invitation_link,
              used_at,
              revoked_at,
              token_expires_at,
              expires_at
       FROM patient_invitations
       WHERE physician_id = $1
       ORDER BY sent_at DESC NULLS LAST, patient_name ASC`,
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

      return {
        id: row.id,
        patientName: row.patient_name,
        patientEmail: row.patient_email,
        sentAt: row.sent_at,
        invitationLink: row.invitation_link,
        openable,
        invalidReason,
      };
    });

    return NextResponse.json({ invitations });
  } catch (error) {
    console.error("[invitations/list] Error fetching invitations", error);
    return NextResponse.json({ error: "Failed to fetch invitations" }, { status: 500 });
  }
}

