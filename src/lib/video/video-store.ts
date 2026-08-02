/**
 * Database access for video visits.
 *
 * The one rule worth stating up front: `oscar_appointment_no` is a key *inside a tenant*, never
 * a credential. Every function here takes `organizationId` explicitly, and every caller must
 * source it from the session — never from a URL parameter. Two clinics on separate OSCAR
 * instances have overlapping appointment-number spaces, so an unscoped lookup would let one
 * clinic's day sheet open the other's consultation.
 */

import { query } from "@/lib/db";
import { decryptString, encryptString } from "@/lib/encrypted-field";
import { createDailyRoom, deleteDailyRoom } from "./daily";
import { roomExpiryFor } from "./join-window";
import { generateVisitToken, hashVisitToken } from "./visit-token";

export type VideoVisit = {
  id: string;
  organizationId: string;
  appointmentId: string | null;
  oscarAppointmentNo: string | null;
  physicianId: string | null;
  dailyRoomName: string;
  dailyRoomUrl: string;
  roomExpiresAt: Date;
  patientJoinExpiresAt: Date;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  patientDisplayName: string | null;
  oscarDemographicNo: string | null;
  status: string;
  providerLastSeenAt: Date | null;
  patientLastSeenAt: Date | null;
  cancelledAt: Date | null;
};

/** Returned only when a visit is first created — the raw token is never recoverable after. */
export type CreatedVideoVisit = VideoVisit & { patientJoinTokenRaw: string };

const SELECT_COLUMNS = `
  v.id, v.organization_id, v.appointment_id, v.oscar_appointment_no, v.physician_id,
  v.daily_room_name, v.daily_room_url, v.room_expires_at, v.patient_join_expires_at,
  v.scheduled_start_at, v.scheduled_end_at, v.patient_display_name, v.oscar_demographic_no,
  v.status, v.provider_last_seen_at, v.patient_last_seen_at`;

type VisitDbRow = {
  id: string;
  organization_id: string;
  appointment_id: string | null;
  oscar_appointment_no: string | null;
  physician_id: string | null;
  daily_room_name: string;
  daily_room_url: string;
  room_expires_at: Date;
  patient_join_expires_at: Date;
  scheduled_start_at: Date | null;
  scheduled_end_at: Date | null;
  patient_display_name: string | null;
  oscar_demographic_no: string | null;
  status: string;
  provider_last_seen_at: Date | null;
  patient_last_seen_at: Date | null;
  appointment_cancelled_at?: Date | null;
};

function mapVisit(row: VisitDbRow): VideoVisit {
  return {
    id: row.id,
    organizationId: row.organization_id,
    appointmentId: row.appointment_id,
    oscarAppointmentNo: row.oscar_appointment_no,
    physicianId: row.physician_id,
    dailyRoomName: row.daily_room_name,
    dailyRoomUrl: row.daily_room_url,
    roomExpiresAt: row.room_expires_at,
    patientJoinExpiresAt: row.patient_join_expires_at,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    patientDisplayName: row.patient_display_name,
    oscarDemographicNo: row.oscar_demographic_no,
    status: row.status,
    providerLastSeenAt: row.provider_last_seen_at,
    patientLastSeenAt: row.patient_last_seen_at,
    // Cancelling the appointment is what cancels the visit; the join check reads both so a
    // cancellation that failed to propagate still closes the room.
    cancelledAt: row.appointment_cancelled_at ?? null,
  };
}

export type VisitCreationResult =
  | { ok: true; visit: VideoVisit; joinTokenRaw: string | null; created: boolean }
  | { ok: false; status: number; detail: string };

/**
 * The visit for an app-booked appointment, creating the Daily room on first use.
 *
 * `joinTokenRaw` is non-null only on the call that created the row. Everywhere else the token
 * is unrecoverable by design — it exists hashed, and a provider who needs to re-send the link
 * sends the stored join URL, not a freshly minted one.
 */
export async function getOrCreateVisitForAppointment(args: {
  organizationId: string;
  appointmentId: string;
}): Promise<VisitCreationResult> {
  const existing = await query<VisitDbRow>(
    `SELECT ${SELECT_COLUMNS}, a.cancelled_at AS appointment_cancelled_at
       FROM video_visits v
       LEFT JOIN appointments a ON a.id = v.appointment_id
      WHERE v.organization_id = $1 AND v.appointment_id = $2
      LIMIT 1`,
    [args.organizationId, args.appointmentId],
  );
  if (existing.rows[0]) {
    return { ok: true, visit: mapVisit(existing.rows[0]), joinTokenRaw: null, created: false };
  }

  const apptRes = await query<{
    physician_id: string;
    first_name: string;
    last_name: string;
    oscar_demographic_no: string | null;
    oscar_appointment_no: string | null;
    start_time: Date | null;
    end_time: Date | null;
    cancelled_at: Date | null;
  }>(
    `SELECT a.physician_id, a.first_name, a.last_name, a.oscar_demographic_no,
            a.oscar_appointment_no, s.start_time, s.end_time, a.cancelled_at
       FROM appointments a
       LEFT JOIN appointment_slots s ON s.id = a.slot_id
      WHERE a.id = $1 AND a.organization_id = $2
      LIMIT 1`,
    [args.appointmentId, args.organizationId],
  );
  const appt = apptRes.rows[0];
  if (!appt) return { ok: false, status: 404, detail: "Appointment not found" };
  if (appt.cancelled_at) return { ok: false, status: 409, detail: "Appointment is cancelled" };

  return insertVisit({
    organizationId: args.organizationId,
    appointmentId: args.appointmentId,
    oscarAppointmentNo: appt.oscar_appointment_no,
    physicianId: appt.physician_id,
    scheduledStartAt: appt.start_time,
    scheduledEndAt: appt.end_time,
    patientDisplayName: `${appt.first_name} ${appt.last_name}`.trim(),
    oscarDemographicNo: appt.oscar_demographic_no,
  });
}

/**
 * The visit behind the OSCAR day-sheet button.
 *
 * The first thing this does is try to collapse onto an existing appointment. An online booking
 * that has synced to OSCAR has *both* keys, so keying blindly on the OSCAR number would mint a
 * second room while the patient sits holding a link to the first — the provider and the patient
 * would each be alone in a different room, which is the worst possible failure for this feature.
 */
export async function getOrCreateVisitForOscarAppointment(args: {
  organizationId: string;
  oscarAppointmentNo: string;
  oscarDemographicNo?: string | null;
  physicianId: string | null;
}): Promise<VisitCreationResult> {
  const linked = await query<{ id: string }>(
    `SELECT id FROM appointments
      WHERE organization_id = $1 AND oscar_appointment_no = $2 AND cancelled_at IS NULL
      LIMIT 1`,
    [args.organizationId, args.oscarAppointmentNo],
  );
  if (linked.rows[0]) {
    return getOrCreateVisitForAppointment({
      organizationId: args.organizationId,
      appointmentId: linked.rows[0].id,
    });
  }

  const existing = await query<VisitDbRow>(
    `SELECT ${SELECT_COLUMNS}, NULL::timestamptz AS appointment_cancelled_at
       FROM video_visits v
      WHERE v.organization_id = $1 AND v.oscar_appointment_no = $2
      LIMIT 1`,
    [args.organizationId, args.oscarAppointmentNo],
  );
  if (existing.rows[0]) {
    return { ok: true, visit: mapVisit(existing.rows[0]), joinTokenRaw: null, created: false };
  }

  // An OSCAR-only visit: no appointment row, so no schedule and no patient name of our own.
  // resolveJoinState() treats a null start as "joinable until the token expires", which is the
  // right behaviour for a room a provider opened deliberately.
  return insertVisit({
    organizationId: args.organizationId,
    appointmentId: null,
    oscarAppointmentNo: args.oscarAppointmentNo,
    physicianId: args.physicianId,
    scheduledStartAt: null,
    scheduledEndAt: null,
    patientDisplayName: null,
    oscarDemographicNo: args.oscarDemographicNo ?? null,
  });
}

async function insertVisit(args: {
  organizationId: string;
  appointmentId: string | null;
  oscarAppointmentNo: string | null;
  physicianId: string | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  patientDisplayName: string | null;
  oscarDemographicNo: string | null;
}): Promise<VisitCreationResult> {
  const now = new Date();
  const roomExpiresAt = roomExpiryFor(args.scheduledEndAt, now);

  const room = await createDailyRoom({ expiresAt: roomExpiresAt });
  if (!room.ok) {
    console.error(`[video] Daily room creation failed (${room.status}): ${room.detail}`);
    return { ok: false, status: 502, detail: "Could not create the video room" };
  }

  const token = generateVisitToken(args.scheduledEndAt);

  try {
    const res = await query<VisitDbRow>(
      `INSERT INTO video_visits (
         organization_id, appointment_id, oscar_appointment_no, physician_id,
         daily_room_name, daily_room_url, room_expires_at,
         patient_join_token_hash, patient_join_token_enc, patient_join_expires_at,
         scheduled_start_at, scheduled_end_at, patient_display_name, oscar_demographic_no
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, organization_id, appointment_id, oscar_appointment_no, physician_id,
                 daily_room_name, daily_room_url, room_expires_at, patient_join_expires_at,
                 scheduled_start_at, scheduled_end_at, patient_display_name,
                 oscar_demographic_no, status, provider_last_seen_at, patient_last_seen_at`,
      [
        args.organizationId,
        args.appointmentId,
        args.oscarAppointmentNo,
        args.physicianId,
        room.value.name,
        room.value.url,
        roomExpiresAt,
        token.hash,
        // Encrypted, not hashed — see migration 068. Read only to rebuild the join URL for an
        // outbound message; never returned to a client and never logged.
        encryptString(token.raw),
        token.expiresAt,
        args.scheduledStartAt,
        args.scheduledEndAt,
        args.patientDisplayName,
        args.oscarDemographicNo,
      ],
    );
    return { ok: true, visit: mapVisit(res.rows[0]), joinTokenRaw: token.raw, created: true };
  } catch (err) {
    // Two providers clicking the button at the same instant race on the partial unique index.
    // The loser deletes the room it just made and re-reads the winner's row, so both land in
    // the same place rather than one getting an error page.
    void deleteDailyRoom(room.value.name);
    if ((err as { code?: string }).code === "23505") {
      const reread = args.appointmentId
        ? await getOrCreateVisitForAppointment({
            organizationId: args.organizationId,
            appointmentId: args.appointmentId,
          })
        : await getOrCreateVisitForOscarAppointment({
            organizationId: args.organizationId,
            oscarAppointmentNo: args.oscarAppointmentNo!,
            physicianId: args.physicianId,
          });
      return reread;
    }
    console.error("[video] visit insert failed:", err);
    return { ok: false, status: 500, detail: "Could not record the video visit" };
  }
}

/** Look a visit up by the patient's raw join token. Returns null for unknown or malformed. */
export async function getVisitByJoinToken(rawToken: string): Promise<VideoVisit | null> {
  const res = await query<VisitDbRow>(
    `SELECT ${SELECT_COLUMNS}, a.cancelled_at AS appointment_cancelled_at
       FROM video_visits v
       LEFT JOIN appointments a ON a.id = v.appointment_id
      WHERE v.patient_join_token_hash = $1
      LIMIT 1`,
    [hashVisitToken(rawToken)],
  );
  return res.rows[0] ? mapVisit(res.rows[0]) : null;
}

/** Org-scoped fetch for provider-side routes that already hold a visit id. */
export async function getVisitById(
  visitId: string,
  organizationId: string,
): Promise<VideoVisit | null> {
  const res = await query<VisitDbRow>(
    `SELECT ${SELECT_COLUMNS}, a.cancelled_at AS appointment_cancelled_at
       FROM video_visits v
       LEFT JOIN appointments a ON a.id = v.appointment_id
      WHERE v.id = $1 AND v.organization_id = $2
      LIMIT 1`,
    [visitId, organizationId],
  );
  return res.rows[0] ? mapVisit(res.rows[0]) : null;
}

/**
 * Presence heartbeat. `*_first_joined_at` is written once for the audit trail;
 * `*_last_seen_at` is what the other side actually reads, because only freshness distinguishes
 * "in the room" from "opened the page an hour ago and left".
 */
export async function touchPresence(
  visitId: string,
  who: "provider" | "patient",
): Promise<void> {
  const firstCol = who === "provider" ? "provider_first_joined_at" : "patient_first_joined_at";
  const lastCol = who === "provider" ? "provider_last_seen_at" : "patient_last_seen_at";
  await query(
    `UPDATE video_visits
        SET ${firstCol} = COALESCE(${firstCol}, NOW()),
            ${lastCol} = NOW()
      WHERE id = $1`,
    [visitId],
  );
}

/** How stale a heartbeat may be before the other side is shown as gone. */
export const PRESENCE_STALE_MS = 30_000;

export function isPresent(lastSeenAt: Date | null, now: Date = new Date()): boolean {
  if (!lastSeenAt) return false;
  return now.getTime() - lastSeenAt.getTime() < PRESENCE_STALE_MS;
}

/**
 * Rebuild the patient's join URL so it can be sent again.
 *
 * The single reader of `patient_join_token_enc`. Kept in the store rather than inlined in the
 * route so there is exactly one place that decrypts, and so the surrounding code never has to
 * hold the raw token in a variable it might log.
 *
 * Returns null for a visit created before migration 068 — the patient's existing link still
 * works, it just cannot be regenerated, and the caller tells the provider that.
 */
export async function getJoinUrlForResend(
  visitId: string,
  organizationId: string,
  appUrl: string,
): Promise<string | null> {
  const res = await query<{ patient_join_token_enc: string | null }>(
    `SELECT patient_join_token_enc FROM video_visits WHERE id = $1 AND organization_id = $2`,
    [visitId, organizationId],
  );
  const enc = res.rows[0]?.patient_join_token_enc;
  if (!enc) return null;
  try {
    return `${appUrl}/visit/${decryptString(enc)}`;
  } catch (err) {
    // A key rotation or a corrupt payload. Log that it happened, never what it contained.
    console.error(`[video] could not decrypt join token for visit ${visitId}:`, (err as Error).message);
    return null;
  }
}

/** Record that the link went out. The destination is deliberately not stored. */
export async function recordLinkSend(
  visitId: string,
  channel: "sms" | "email",
): Promise<void> {
  await query(
    `UPDATE video_visits
        SET link_send_count = link_send_count + 1,
            link_last_sent_at = NOW(),
            link_last_channel = $2
      WHERE id = $1`,
    [visitId, channel],
  );
}

/** Cancel a visit and release its Daily room. Best-effort on the Daily side. */
export async function cancelVisitsForAppointment(appointmentId: string): Promise<void> {
  const res = await query<{ daily_room_name: string }>(
    `UPDATE video_visits
        SET status = 'CANCELLED', ended_at = COALESCE(ended_at, NOW())
      WHERE appointment_id = $1 AND status <> 'CANCELLED'
      RETURNING daily_room_name`,
    [appointmentId],
  );
  for (const row of res.rows) {
    const del = await deleteDailyRoom(row.daily_room_name);
    if (!del.ok) {
      console.error(`[video] room delete failed for ${row.daily_room_name}: ${del.detail}`);
    }
  }
}
