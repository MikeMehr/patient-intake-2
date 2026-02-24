import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

type Params = { invitationId: string };

export async function DELETE(_req: NextRequest, context: { params: Promise<Params> }) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (session.userType !== "provider") {
      return NextResponse.json({ error: "Only providers can delete invitations" }, { status: 403 });
    }

    const physicianId = (session as any).physicianId || session.userId;

    const { invitationId } = await context.params;

    const result = await query(
      `DELETE FROM patient_invitations
       WHERE id = $1 AND physician_id = $2
       RETURNING id`,
      [invitationId, physicianId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[invitations/delete] Error deleting invitation", error);
    return NextResponse.json({ error: "Failed to delete invitation" }, { status: 500 });
  }
}

