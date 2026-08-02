/**
 * Open (or create) the video room for an appointment, from the provider's side.
 *
 * This is the endpoint behind the OSCAR day-sheet button. It accepts an OSCAR appointment
 * number, but that number is only ever a *key inside the caller's own organization* — the
 * organization itself comes from the session, so a provider at one clinic cannot reach another
 * clinic's visit by guessing a number.
 *
 * Protected twice over: `/api/physician/` is in PHYSICIAN_API_PREFIXES so the proxy 401s a
 * request with no session cookie, and getCurrentSession() re-checks it against the database
 * here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { resolveAppUrl } from "@/lib/app-url";
import { isDailyConfigured, mintDailyMeetingToken } from "@/lib/video/daily";
import {
  ensureLiveRoom,
  getJoinUrlForResend,
  getVisitById,
  getOrCreateVisitForAppointment,
  getOrCreateVisitForOscarAppointment,
  isPresent,
  touchPresence,
} from "@/lib/video/video-store";
import { query } from "@/lib/db";

/** OSCAR appointment numbers are small positive integers; anything else is not worth a query. */
const OSCAR_APPT_NO_RE = /^\d{1,12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!session.organizationId) {
    return NextResponse.json(
      { error: "This account is not linked to a clinic." },
      { status: 403 },
    );
  }
  if (!isDailyConfigured()) {
    return NextResponse.json(
      { error: "Video visits are not configured for this deployment." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { oscarApptNo, appointmentId, demographicNo, visitId } = (body || {}) as {
    oscarApptNo?: string;
    appointmentId?: string;
    demographicNo?: string;
    visitId?: string;
  };

  const organizationId = session.organizationId;
  // video_visits.physician_id is a real FK into `physicians`. An org_admin's userId is a row in
  // organization_users, so resolving it here would violate that FK — record the physician only
  // when the session actually is one (an assistant resolves to their linked provider).
  const physicianId =
    session.userType === "provider" ? getEffectivePhysicianId(session) : null;

  // visitId is how an ad-hoc invite is reopened: it belongs to no appointment and has no OSCAR
  // number, so its own id is the only handle. Still org-scoped — getVisitById takes the
  // organization from the session, so an id from another clinic simply isn't found.
  const result = visitId
    ? UUID_RE.test(visitId)
      ? await (async () => {
          const v = await getVisitById(visitId, organizationId);
          return v
            ? ({ ok: true, visit: v, joinTokenRaw: null, created: false } as const)
            : ({ ok: false, status: 404, detail: "Visit not found" } as const);
        })()
      : ({ ok: false, status: 400, detail: "Invalid visit id" } as const)
    : appointmentId
    ? UUID_RE.test(appointmentId)
      ? await getOrCreateVisitForAppointment({ organizationId, appointmentId })
      : ({ ok: false, status: 400, detail: "Invalid appointment id" } as const)
    : oscarApptNo && OSCAR_APPT_NO_RE.test(oscarApptNo)
      ? await getOrCreateVisitForOscarAppointment({
          organizationId,
          oscarAppointmentNo: oscarApptNo,
          oscarDemographicNo:
            typeof demographicNo === "string" && /^\d{1,12}$/.test(demographicNo)
              ? demographicNo
              : null,
          physicianId,
        })
      : ({ ok: false, status: 400, detail: "An appointment reference is required" } as const);

  if (!result.ok) {
    return NextResponse.json({ error: result.detail }, { status: result.status });
  }

  if (result.visit.status === "CANCELLED" || result.visit.cancelledAt) {
    return NextResponse.json({ error: "This appointment was cancelled." }, { status: 409 });
  }

  // A reused visit may be carrying a room Daily has already deleted — recreate it before
  // handing anyone a URL to it.
  const live = await ensureLiveRoom(result.visit);
  if (!live.ok) {
    return NextResponse.json({ error: live.detail }, { status: live.status });
  }
  const visit = live.visit;
  const joinTokenRaw = result.joinTokenRaw ?? live.joinTokenRaw;

  // The provider is the room owner: they can end the call for everyone. Their token outlives
  // the room slightly so a reconnect near the end doesn't bounce them.
  const providerName = `Dr. ${session.lastName || session.username}`.trim();
  const token = await mintDailyMeetingToken({
    roomName: visit.dailyRoomName,
    userName: providerName,
    isOwner: true,
    expiresAt: visit.roomExpiresAt,
  });
  if (!token.ok) {
    console.error(`[video] provider token mint failed (${token.status}): ${token.detail}`);
    return NextResponse.json({ error: "Could not join the video room." }, { status: 502 });
  }

  await touchPresence(visit.id, "provider");

  const appUrl = resolveAppUrl(request);
  const contact = await resolvePatientContact(visit.appointmentId, organizationId);

  return NextResponse.json({
    visitId: visit.id,
    roomUrl: visit.dailyRoomUrl,
    meetingToken: token.value,
    // Since migration 068 the token is recoverable, so this is populated on every open — the
    // provider can copy or re-send the link whether or not this request created the room. Null
    // only for visits created before that migration.
    patientJoinUrl:
      joinTokenRaw
        ? `${appUrl}/visit/${joinTokenRaw}`
        : await getJoinUrlForResend(visit.id, organizationId, appUrl),
    patientName: visit.patientDisplayName,
    scheduledStartAt: visit.scheduledStartAt?.toISOString() ?? null,
    patientPresent: isPresent(visit.patientLastSeenAt),
    suggestedEmail: contact.email,
    suggestedPhone: contact.phone,
  });
}

/**
 * Prefill for the "send the link" form. Only ever from our own appointment row — a visit
 * created straight from the day sheet has no contact details here, and the provider types them.
 */
async function resolvePatientContact(
  appointmentId: string | null,
  organizationId: string,
): Promise<{ email: string | null; phone: string | null }> {
  if (!appointmentId) return { email: null, phone: null };
  const res = await query<{ email: string | null; patient_phone: string | null }>(
    `SELECT email, patient_phone FROM appointments WHERE id = $1 AND organization_id = $2`,
    [appointmentId, organizationId],
  );
  const row = res.rows[0];
  return { email: row?.email ?? null, phone: row?.patient_phone ?? null };
}
