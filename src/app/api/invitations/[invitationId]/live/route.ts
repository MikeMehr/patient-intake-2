import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { query } from "@/lib/db";

export const runtime = "nodejs";

type Params = { invitationId: string };

// GET /api/invitations/[invitationId]/live?since=<turnIndex>
// Returns live turns for the physician monitor window. Physician must own the invitation.
export async function GET(req: NextRequest, context: { params: Promise<Params> }) {
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

    const sinceParam = req.nextUrl.searchParams.get("since");
    const since = sinceParam !== null ? parseInt(sinceParam, 10) : -1;

    // Fetch invitation metadata — verify ownership and get display fields
    const invResult = await query<{
      patient_name: string;
      request_phq_gad: boolean;
      monitor_guidance: string | null;
      session_saved: boolean;
      revoked_at: string | null;
    }>(
      `SELECT pi.patient_name, pi.request_phq_gad, pi.monitor_guidance,
              pi.revoked_at,
              EXISTS(
                SELECT 1 FROM invitation_audit_log ial
                WHERE ial.invitation_id = pi.id AND ial.event_type = 'session_saved'
              ) AS session_saved
       FROM patient_invitations pi
       WHERE pi.id = $1 AND pi.physician_id = $2
       LIMIT 1`,
      [invitationId, physicianId],
    );

    if (invResult.rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const inv = invResult.rows[0];

    // Fetch new turns since the given index
    const turnsResult = await query<{
      id: string;
      turn_index: number;
      role: string;
      content: string;
      rationale: string | null;
      state_snapshot: Record<string, unknown> | null;
      is_summary: boolean;
      created_at: string;
    }>(
      `SELECT id, turn_index, role, content, rationale, state_snapshot, is_summary, created_at
       FROM interview_live_turns
       WHERE invitation_id = $1 AND turn_index > $2
       ORDER BY turn_index ASC`,
      [invitationId, since],
    );

    // Derive content_en for each turn from existing columns (no schema migration needed):
    // - assistant turns: stored in state_snapshot.contentEn
    // - patient turns: stored in rationale column (repurposed; patient rows never have a real rationale)
    const turns = turnsResult.rows.map((row) => {
      let content_en: string | null = null;
      if (row.role === "assistant" && row.state_snapshot) {
        const snap = row.state_snapshot as Record<string, unknown>;
        content_en = typeof snap.contentEn === "string" ? snap.contentEn : null;
      } else if (row.role === "patient") {
        content_en = row.rationale ?? null;
      }
      return { ...row, content_en, rationale: row.role === "patient" ? null : row.rationale };
    });

    return NextResponse.json({
      turns,
      patientName: inv.patient_name,
      requestPhqGad: Boolean(inv.request_phq_gad),
      guidancePending: Boolean(inv.monitor_guidance),
      isCompleted: Boolean(inv.session_saved || inv.revoked_at),
    });
  } catch (error) {
    console.error("[invitations/live] GET error", error);
    return NextResponse.json({ error: "Failed to fetch live data" }, { status: 500 });
  }
}

// PATCH /api/invitations/[invitationId]/live
// Saves physician guidance to be delivered on the patient's next interview turn.
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

    const guidance = (body as Record<string, unknown>)?.physicianGuidance;
    if (typeof guidance !== "string") {
      return NextResponse.json({ error: "physicianGuidance must be a string" }, { status: 400 });
    }

    const trimmed = guidance.trim().slice(0, 2000);

    const result = await query(
      `UPDATE patient_invitations
       SET monitor_guidance = $1
       WHERE id = $2 AND physician_id = $3
       RETURNING id`,
      [trimmed || null, invitationId, physicianId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[invitations/live] PATCH error", error);
    return NextResponse.json({ error: "Failed to save guidance" }, { status: 500 });
  }
}
