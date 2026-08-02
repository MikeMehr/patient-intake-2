/**
 * Issue the patient's room credential. This is the ONLY place the Daily room URL and a patient
 * meeting token leave the server, and only when the join window is open.
 *
 * Keeping this separate from the validation GET is what makes the link safe to email: outside
 * the window the link renders a countdown and nothing more, so a forwarded or long-since-read
 * message is not a way into a live consultation.
 */

import { NextRequest, NextResponse } from "next/server";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { resolveJoinState } from "@/lib/video/join-window";
import { isVisitTokenShape } from "@/lib/video/visit-token";
import { isDailyConfigured, mintDailyMeetingToken } from "@/lib/video/daily";
import { getVisitByJoinToken, touchPresence } from "@/lib/video/video-store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!isVisitTokenShape(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isDailyConfigured()) {
    return NextResponse.json(
      { error: "Video visits are not available right now." },
      { status: 503 },
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await consumeDbRateLimit({
    bucketKey: `visit-join:${ip}`,
    maxAttempts: 20,
    windowSeconds: 300,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const visit = await getVisitByJoinToken(token);
  if (!visit) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const state = resolveJoinState({
    now: new Date(),
    scheduledStartAt: visit.scheduledStartAt,
    scheduledEndAt: visit.scheduledEndAt,
    cancelledAt: visit.cancelledAt,
    tokenExpiresAt: visit.patientJoinExpiresAt,
    status: visit.status,
  });
  if (state !== "open") {
    return NextResponse.json({ error: "not_open", state }, { status: 409 });
  }

  // Not an owner: the patient cannot end the call for everyone or eject the provider. The
  // token dies with the room, so a copied token is useless once the visit is over.
  const meetingToken = await mintDailyMeetingToken({
    roomName: visit.dailyRoomName,
    userName: visit.patientDisplayName ?? "Patient",
    isOwner: false,
    expiresAt: visit.roomExpiresAt,
  });
  if (!meetingToken.ok) {
    console.error(`[video] patient token mint failed (${meetingToken.status}): ${meetingToken.detail}`);
    return NextResponse.json({ error: "Could not join the video call." }, { status: 502 });
  }

  await touchPresence(visit.id, "patient");

  return NextResponse.json({
    roomUrl: visit.dailyRoomUrl,
    meetingToken: meetingToken.value,
    userName: visit.patientDisplayName ?? "Patient",
  });
}
