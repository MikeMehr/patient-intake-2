/**
 * Validate a patient's video-visit link. Public — the token is the credential.
 *
 * This endpoint deliberately hands back **no room credential of any kind**: no Daily URL, no
 * meeting token, not even the room name. It only says whether the visit exists, when it starts,
 * and who it is with, so the waiting room can render a countdown. The actual credential is
 * issued by POST /join, and only inside the join window — which is the whole point of the
 * split. A confirmation email forwarded to the wrong person, or read months later, is then not
 * a way into a consultation.
 *
 * "Not found" and "expired" return the same shape on purpose, so this cannot be used to test
 * whether a token exists.
 */

import { NextRequest, NextResponse } from "next/server";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { query } from "@/lib/db";
import { joinOpensAt, resolveJoinState } from "@/lib/video/join-window";
import { isVisitTokenShape } from "@/lib/video/visit-token";
import { getVisitByJoinToken, isPresent } from "@/lib/video/video-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!isVisitTokenShape(token)) {
    return NextResponse.json({ state: "not_found" }, { status: 404 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await consumeDbRateLimit({
    bucketKey: `visit-lookup:${ip}`,
    maxAttempts: 60,
    windowSeconds: 300,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { state: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
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

  // Same response as an unknown token, so an expired link is not an oracle either.
  if (state === "expired") {
    return NextResponse.json({ state: "not_found" }, { status: 404 });
  }

  const context = await loadVisitContext(visit.organizationId, visit.physicianId);

  return NextResponse.json({
    state,
    clinicName: context.clinicName,
    physicianName: context.physicianName,
    patientFirstName: visit.patientDisplayName?.split(" ")[0] ?? null,
    scheduledStartAt: visit.scheduledStartAt?.toISOString() ?? null,
    joinOpensAt: joinOpensAt(visit.scheduledStartAt)?.toISOString() ?? null,
    providerPresent: isPresent(visit.providerLastSeenAt),
  });
}

/** Clinic and physician names for the waiting room. Nothing here is PHI. */
async function loadVisitContext(
  organizationId: string,
  physicianId: string | null,
): Promise<{ clinicName: string | null; physicianName: string | null }> {
  const orgRes = await query<{ name: string }>(
    `SELECT name FROM organizations WHERE id = $1`,
    [organizationId],
  );
  let physicianName: string | null = null;
  if (physicianId) {
    const physRes = await query<{ first_name: string; last_name: string }>(
      `SELECT first_name, last_name FROM physicians WHERE id = $1`,
      [physicianId],
    );
    const p = physRes.rows[0];
    if (p) physicianName = `Dr. ${p.first_name} ${p.last_name}`.trim();
  }
  return { clinicName: orgRes.rows[0]?.name ?? null, physicianName };
}
