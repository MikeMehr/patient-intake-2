import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { startInvitationCleanup } from "@/lib/invitations-cleanup";

export const runtime = "nodejs";

type InvitationRow = {
  id: string;
  patient_name: string;
  patient_email: string;
  sent_at: string | null;
};

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
      `SELECT id, patient_name, patient_email, sent_at
       FROM patient_invitations
       WHERE physician_id = $1
       ORDER BY sent_at DESC NULLS LAST, patient_name ASC`,
      [physicianId],
    );

    const invitations = result.rows.map((row) => ({
      id: row.id,
      patientName: row.patient_name,
      patientEmail: row.patient_email,
      sentAt: row.sent_at,
    }));

    return NextResponse.json({ invitations });
  } catch (error) {
    console.error("[invitations/list] Error fetching invitations", error);
    return NextResponse.json({ error: "Failed to fetch invitations" }, { status: 500 });
  }
}

