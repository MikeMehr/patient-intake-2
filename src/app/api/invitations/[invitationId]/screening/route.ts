import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";

export const runtime = "nodejs";

type Params = { invitationId: string };

// PATCH /api/invitations/[invitationId]/screening
// Allows physician to enable PHQ-9/GAD-7 screening mid-interview from the monitor window.
export async function PATCH(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (session.userType !== "provider") {
      return NextResponse.json({ error: "Provider access required" }, { status: 403 });
    }

    const physicianId = getEffectivePhysicianId(session);
    const { invitationId } = await context.params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const requestPhqGad = (body as Record<string, unknown>)?.requestPhqGad;
    if (typeof requestPhqGad !== "boolean") {
      return NextResponse.json({ error: "requestPhqGad must be a boolean" }, { status: 400 });
    }

    const result = await query(
      `UPDATE patient_invitations
       SET request_phq_gad = $1
       WHERE id = $2 AND physician_id = $3
       RETURNING id`,
      [requestPhqGad, invitationId, physicianId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[invitations/screening] PATCH error", error);
    return NextResponse.json({ error: "Failed to update screening flag" }, { status: 500 });
  }
}
