/**
 * Provider presence heartbeat, polled from the video console.
 *
 * This is what drives the patient's "Dr. X has joined" banner. It is a heartbeat rather than a
 * one-shot flag so the banner goes away again when the provider's laptop sleeps or their tab
 * closes — a patient told their doctor is present when nobody is there will sit and wait.
 *
 * Returns the patient's presence in the same call, so the console needs one poll, not two.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getVisitById, isPresent, touchPresence } from "@/lib/video/video-store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ visitId: string }> },
) {
  const session = await getCurrentSession();
  if (!session?.organizationId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { visitId } = await params;
  if (!UUID_RE.test(visitId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Org-scoped read before the write: without it, a valid session at clinic A could keep
  // clinic B's visit looking live.
  const visit = await getVisitById(visitId, session.organizationId);
  if (!visit) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await touchPresence(visit.id, "provider");

  return NextResponse.json({
    patientPresent: isPresent(visit.patientLastSeenAt),
    status: visit.status,
  });
}
