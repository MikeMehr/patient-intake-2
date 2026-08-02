/**
 * Patient-side poll: is the doctor here yet, and is the visit still on?
 *
 * Doubles as the patient's own presence heartbeat, which is what the provider console reads to
 * show "patient is waiting". Polled every 4s, matching the existing live-monitor convention in
 * src/app/physician/monitor/[invitationId]/page.tsx — there is no realtime transport in this
 * app, and adding one for a boolean would not be worth it.
 *
 * Carries no credential and no PHI, so it is safe to hit repeatedly from an unauthenticated
 * page.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveJoinState } from "@/lib/video/join-window";
import { isVisitTokenShape } from "@/lib/video/visit-token";
import { getVisitByJoinToken, isPresent, touchPresence } from "@/lib/video/video-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isVisitTokenShape(token)) {
    return NextResponse.json({ state: "not_found" }, { status: 404 });
  }

  const visit = await getVisitByJoinToken(token);
  if (!visit) {
    return NextResponse.json({ state: "not_found" }, { status: 404 });
  }

  const state = resolveJoinState({
    now: new Date(),
    scheduledStartAt: visit.scheduledStartAt,
    scheduledEndAt: visit.scheduledEndAt,
    cancelledAt: visit.cancelledAt,
    tokenExpiresAt: visit.patientJoinExpiresAt,
    status: visit.status,
  });

  // Only count the patient as present while they could actually be in the room. Polling from a
  // countdown screen an hour early should not tell the provider anyone is waiting.
  if (state === "open") {
    await touchPresence(visit.id, "patient");
  }

  return NextResponse.json({
    state: state === "expired" ? "not_found" : state,
    providerPresent: isPresent(visit.providerLastSeenAt),
  });
}
