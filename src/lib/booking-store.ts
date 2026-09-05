/**
 * Database query helpers for the online booking system.
 */

import { query } from "@/lib/db";
import { encryptString, decryptString } from "@/lib/encrypted-field";
import { type AppointmentModality, normalizeModality } from "@/lib/appointment-modality";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BookingSettings = {
  id: string;
  organizationId: string;
  onlineBookingEnabled: boolean;
  publicBookingStart: string; // "HH:MM"
  publicBookingEnd: string;   // "HH:MM"
  enforceBookingWindow: boolean;
  slotIntervalMinutes: number;
  healthCardRequired: boolean;
  showBlockedSlots: boolean;
  /** The clinic default. Since migration 067 an appointment may carry its own. */
  appointmentModality: AppointmentModality;
  videoVisitsEnabled: boolean;
  patientMayChooseModality: boolean;
  cancellationPolicy: string | null;
  bookingInstructions: string | null;
  emailFooter: string | null;
  timezone: string;
  selfServeInterviewEnabled: boolean;
  selfServeInterviewPhysicianId: string | null;
};

export type ClinicInfo = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  address: string | null;
  phone: string | null;
  websiteUrl: string | null;
  settings: BookingSettings | null;
};

export type BookingPhysician = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
};

export type AppointmentSlot = {
  id: string;
  organizationId: string;
  physicianId: string;
  physicianName: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  status: "OPEN" | "BLOCKED" | "HELD" | "BOOKED";
  /**
   * Whether this slot's physician can actually hold a video visit — i.e. they have a Doxy
   * waiting room. Doxy rooms are per-provider and cannot be created on demand, so a provider
   * without one has nowhere to send the patient: the booking succeeds, the confirmation email
   * promises a link, and no link exists. Offering the choice per slot rather than per clinic is
   * what keeps that promise honest in a practice where only some providers do video.
   */
  videoAvailable: boolean;
};

export type AppointmentRow = {
  id: string;
  organizationId: string;
  physicianId: string;
  physicianFirstName: string;
  physicianLastName: string;
  physicianOnlineBookingEnabled: boolean;
  slotId: string;
  slotStartTime: string;
  slotEndTime: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  coverageType: string;
  province: string | null;
  healthCardNumber: string | null; // decrypted
  billingNote: string | null;
  reason: string | null; // patient-entered reason for visit
  appointmentModality: string | null; // null = inherit the clinic setting
  patientPhone: string | null;
  manageTokenExpiresAt: string;
  cancelledAt: string | null;
  createdAt: string;
  oscarSyncStatus: string | null; // 'SYNCED' | 'FAILED' | 'SKIPPED' | 'CANCELLED' | null
  oscarAppointmentNo: string | null; // OSCAR appointment id, when synced
  pharmacyName: string | null; // patient's preferred pharmacy, when they chose one
  pharmacyCity: string | null;
  pharmacyLinkStatus: string | null; // 'LINKED' | 'FAILED' | 'SKIPPED' | null (none chosen)
  aiScribeConsent: boolean | null; // null = question not asked (pre-feature rows)
  attachments?: AppointmentAttachment[]; // files the patient attached when booking
};

export type AppointmentAttachment = {
  id: string;
  filename: string | null;
  contentType: string | null;
};

// ---------------------------------------------------------------------------
// Clinic / settings lookups
// ---------------------------------------------------------------------------

export async function getClinicBySlug(slug: string): Promise<ClinicInfo | null> {
  const result = await query<{
    id: string;
    name: string;
    slug: string;
    email: string | null;
    business_address: string | null;
    phone: string | null;
    website_url: string | null;
    bs_id: string | null;
    online_booking_enabled: boolean | null;
    public_booking_start: string | null;
    public_booking_end: string | null;
    enforce_booking_window: boolean | null;
    slot_interval_minutes: number | null;
    health_card_required: boolean | null;
    show_blocked_slots: boolean | null;
    appointment_modality: string | null;
    video_visits_enabled: boolean | null;
    patient_may_choose_modality: boolean | null;
    cancellation_policy: string | null;
    booking_instructions: string | null;
    email_footer: string | null;
    timezone: string | null;
    self_serve_interview_enabled: boolean | null;
    self_serve_interview_physician_id: string | null;
  }>(
    `SELECT
       o.id, o.name, o.slug, o.email, o.business_address, o.phone, o.website_url,
       bs.id                    AS bs_id,
       bs.online_booking_enabled,
       bs.public_booking_start::TEXT,
       bs.public_booking_end::TEXT,
       bs.enforce_booking_window,
       bs.slot_interval_minutes,
       bs.health_card_required,
       bs.show_blocked_slots,
       bs.appointment_modality,
       bs.video_visits_enabled,
       bs.patient_may_choose_modality,
       bs.cancellation_policy,
       bs.booking_instructions,
       bs.email_footer,
       bs.timezone,
       bs.self_serve_interview_enabled,
       bs.self_serve_interview_physician_id
     FROM organizations o
     LEFT JOIN booking_settings bs ON bs.organization_id = o.id
     WHERE o.slug = $1`,
    [slug],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    email: row.email,
    address: row.business_address,
    phone: row.phone,
    websiteUrl: row.website_url,
    settings: row.bs_id
      ? {
          id: row.bs_id,
          organizationId: row.id,
          onlineBookingEnabled: row.online_booking_enabled ?? false,
          publicBookingStart: (row.public_booking_start ?? "07:00").substring(0, 5),
          publicBookingEnd: (row.public_booking_end ?? "22:00").substring(0, 5),
          enforceBookingWindow: row.enforce_booking_window ?? true,
          slotIntervalMinutes: row.slot_interval_minutes ?? 15,
          healthCardRequired: row.health_card_required ?? false,
          showBlockedSlots: row.show_blocked_slots ?? false,
          appointmentModality: normalizeModality(row.appointment_modality),
          videoVisitsEnabled: row.video_visits_enabled ?? false,
          patientMayChooseModality: row.patient_may_choose_modality ?? false,
          cancellationPolicy: row.cancellation_policy,
          bookingInstructions: row.booking_instructions,
          emailFooter: row.email_footer,
          timezone: row.timezone ?? "America/Vancouver",
          selfServeInterviewEnabled: row.self_serve_interview_enabled ?? false,
          selfServeInterviewPhysicianId: row.self_serve_interview_physician_id ?? null,
        }
      : null,
  };
}

/**
 * Resolve the self-serve AI guided interview configuration for a clinic slug.
 * Returns null when the clinic doesn't exist. `enabled` is only true when the
 * feature is turned on AND a valid default physician is configured.
 */
export async function getSelfServeInterviewConfig(slug: string): Promise<{
  clinic: ClinicInfo;
  enabled: boolean;
  physicianId: string | null;
  physicianName: string | null;
} | null> {
  const clinic = await getClinicBySlug(slug);
  if (!clinic) return null;

  const featureOn = clinic.settings?.selfServeInterviewEnabled ?? false;
  const physicianId = clinic.settings?.selfServeInterviewPhysicianId ?? null;

  let physicianName: string | null = null;
  let physicianValid = false;
  if (physicianId) {
    const res = await query<{ first_name: string; last_name: string }>(
      `SELECT first_name, last_name FROM physicians
       WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [physicianId, clinic.id],
    );
    const row = res.rows[0];
    if (row) {
      physicianValid = true;
      physicianName = `Dr. ${row.first_name} ${row.last_name}`;
    }
  }

  return {
    clinic,
    enabled: featureOn && physicianValid,
    physicianId: physicianValid ? physicianId : null,
    physicianName,
  };
}

export async function getBookingSettingsByOrgId(orgId: string): Promise<BookingSettings | null> {
  const result = await query<{
    id: string;
    online_booking_enabled: boolean;
    public_booking_start: string;
    public_booking_end: string;
    enforce_booking_window: boolean;
    slot_interval_minutes: number;
    health_card_required: boolean;
    show_blocked_slots: boolean;
    appointment_modality: string | null;
    video_visits_enabled: boolean | null;
    patient_may_choose_modality: boolean | null;
    cancellation_policy: string | null;
    booking_instructions: string | null;
    email_footer: string | null;
    timezone: string;
    self_serve_interview_enabled: boolean;
    self_serve_interview_physician_id: string | null;
  }>(
    `SELECT id, online_booking_enabled,
            public_booking_start::TEXT, public_booking_end::TEXT,
            enforce_booking_window, slot_interval_minutes,
            health_card_required, show_blocked_slots, appointment_modality,
            video_visits_enabled, patient_may_choose_modality,
            cancellation_policy, booking_instructions, email_footer, timezone,
            self_serve_interview_enabled, self_serve_interview_physician_id
     FROM booking_settings WHERE organization_id = $1`,
    [orgId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    organizationId: orgId,
    onlineBookingEnabled: row.online_booking_enabled,
    publicBookingStart: row.public_booking_start.substring(0, 5),
    publicBookingEnd: row.public_booking_end.substring(0, 5),
    enforceBookingWindow: row.enforce_booking_window,
    slotIntervalMinutes: row.slot_interval_minutes,
    healthCardRequired: row.health_card_required,
    showBlockedSlots: row.show_blocked_slots,
    appointmentModality: normalizeModality(row.appointment_modality),
    videoVisitsEnabled: row.video_visits_enabled ?? false,
    patientMayChooseModality: row.patient_may_choose_modality ?? false,
    cancellationPolicy: row.cancellation_policy,
    bookingInstructions: row.booking_instructions,
    emailFooter: row.email_footer,
    timezone: row.timezone,
    selfServeInterviewEnabled: row.self_serve_interview_enabled ?? false,
    selfServeInterviewPhysicianId: row.self_serve_interview_physician_id ?? null,
  };
}

export async function upsertBookingSettings(
  orgId: string,
  updates: Partial<Omit<BookingSettings, "id" | "organizationId">>,
): Promise<void> {
  await query(
    `INSERT INTO booking_settings (organization_id, online_booking_enabled, public_booking_start,
       public_booking_end, enforce_booking_window, slot_interval_minutes,
       health_card_required, show_blocked_slots, cancellation_policy,
       booking_instructions, timezone, email_footer,
       self_serve_interview_enabled, self_serve_interview_physician_id,
       appointment_modality, video_visits_enabled, patient_may_choose_modality, updated_at)
     VALUES ($1,
       COALESCE($2, FALSE), COALESCE($3, '07:00')::TIME, COALESCE($4, '22:00')::TIME,
       COALESCE($5, TRUE), COALESCE($6, 15), COALESCE($7, FALSE), COALESCE($8, FALSE),
       $9, $10, COALESCE($11, 'America/Vancouver'), $12,
       COALESCE($13, FALSE), $14, COALESCE($15, 'PHONE'),
       COALESCE($16, FALSE), COALESCE($17, FALSE), NOW())
     ON CONFLICT (organization_id) DO UPDATE SET
       online_booking_enabled  = COALESCE($2, booking_settings.online_booking_enabled),
       public_booking_start    = COALESCE($3::TIME, booking_settings.public_booking_start),
       public_booking_end      = COALESCE($4::TIME, booking_settings.public_booking_end),
       enforce_booking_window  = COALESCE($5, booking_settings.enforce_booking_window),
       slot_interval_minutes   = COALESCE($6, booking_settings.slot_interval_minutes),
       health_card_required    = COALESCE($7, booking_settings.health_card_required),
       show_blocked_slots      = COALESCE($8, booking_settings.show_blocked_slots),
       cancellation_policy     = COALESCE($9, booking_settings.cancellation_policy),
       booking_instructions    = COALESCE($10, booking_settings.booking_instructions),
       timezone                = COALESCE($11, booking_settings.timezone),
       email_footer            = COALESCE($12, booking_settings.email_footer),
       self_serve_interview_enabled       = COALESCE($13, booking_settings.self_serve_interview_enabled),
       self_serve_interview_physician_id  = COALESCE($14, booking_settings.self_serve_interview_physician_id),
       appointment_modality    = COALESCE($15, booking_settings.appointment_modality),
       video_visits_enabled       = COALESCE($16, booking_settings.video_visits_enabled),
       patient_may_choose_modality = COALESCE($17, booking_settings.patient_may_choose_modality),
       updated_at              = NOW()`,
    [
      orgId,
      updates.onlineBookingEnabled ?? null,
      updates.publicBookingStart ?? null,
      updates.publicBookingEnd ?? null,
      updates.enforceBookingWindow ?? null,
      updates.slotIntervalMinutes ?? null,
      updates.healthCardRequired ?? null,
      updates.showBlockedSlots ?? null,
      updates.cancellationPolicy ?? null,
      updates.bookingInstructions ?? null,
      updates.timezone ?? null,
      updates.emailFooter ?? null,
      updates.selfServeInterviewEnabled ?? null,
      updates.selfServeInterviewPhysicianId ?? null,
      updates.appointmentModality ?? null,
      updates.videoVisitsEnabled ?? null,
      updates.patientMayChooseModality ?? null,
    ],
  );
}

// ---------------------------------------------------------------------------
// Physician helpers
// ---------------------------------------------------------------------------

export async function getPhysiciansForBooking(orgId: string): Promise<BookingPhysician[]> {
  const result = await query<{ id: string; first_name: string; last_name: string }>(
    `SELECT id, first_name, last_name
     FROM physicians
     WHERE organization_id = $1 AND online_booking_enabled = TRUE
     ORDER BY last_name, first_name`,
    [orgId],
  );

  return result.rows.map((p) => ({
    id: p.id,
    firstName: p.first_name,
    lastName: p.last_name,
    displayName: `Dr. ${p.first_name} ${p.last_name}`,
  }));
}

// ---------------------------------------------------------------------------
// Slot helpers
// ---------------------------------------------------------------------------

/** Release expired holds back to OPEN (lazy cleanup). */
export async function releaseExpiredHolds(): Promise<void> {
  await query(
    `UPDATE appointment_slots
     SET status = 'OPEN', held_until = NULL, held_session_key = NULL, updated_at = NOW()
     WHERE status = 'HELD' AND held_until < NOW()`,
  );
}

export async function getSlots(
  orgId: string,
  opts: {
    physicianId?: string;
    dateFrom: string; // ISO date string "YYYY-MM-DD"
    dateTo: string;
    includeBlocked?: boolean;
    statusFilter?: string[];
    // IANA timezone the dateFrom/dateTo day boundaries are interpreted in.
    // Defaults to the clinic's local zone so "2026-06-10" means local midnight,
    // not UTC midnight (which would leak the prior evening's slots into range).
    timezone?: string;
  },
): Promise<AppointmentSlot[]> {
  await releaseExpiredHolds();

  const tz = opts.timezone || "America/Vancouver";
  const conditions: string[] = [
    "s.organization_id = $1",
    // Interpret the day boundaries at local midnight in the clinic timezone.
    "s.start_time >= (($2::date)::timestamp AT TIME ZONE $4)",
    "s.start_time < ((($3::date + 1)::timestamp) AT TIME ZONE $4)",
  ];
  const params: unknown[] = [orgId, opts.dateFrom, opts.dateTo, tz];
  let idx = 5;

  if (opts.physicianId) {
    conditions.push(`s.physician_id = $${idx++}`);
    params.push(opts.physicianId);
  }

  if (opts.statusFilter && opts.statusFilter.length > 0) {
    conditions.push(`s.status = ANY($${idx++}::VARCHAR[])`);
    params.push(opts.statusFilter);
  }

  const result = await query<{
    id: string;
    organization_id: string;
    physician_id: string;
    first_name: string;
    last_name: string;
    start_time: Date;
    end_time: Date;
    status: string;
    video_available: boolean;
  }>(
    `SELECT s.id, s.organization_id, s.physician_id,
            p.first_name, p.last_name,
            s.start_time, s.end_time, s.status,
            (p.doxy_room_url IS NOT NULL AND p.doxy_room_url <> ''
              AND NOT p.video_visits_disabled) AS video_available
     FROM appointment_slots s
     JOIN physicians p ON p.id = s.physician_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY s.start_time, p.last_name`,
    params,
  );

  return result.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    physicianId: r.physician_id,
    physicianName: `Dr. ${r.first_name} ${r.last_name}`,
    startTime: r.start_time instanceof Date ? r.start_time.toISOString() : String(r.start_time),
    endTime: r.end_time instanceof Date ? r.end_time.toISOString() : String(r.end_time),
    status: r.status as AppointmentSlot["status"],
    videoAvailable: r.video_available === true,
  }));
}

/**
 * Can this physician hold a video visit? Two conditions, and both must hold: they have a Doxy
 * waiting room (*can*), and video has not been switched off for them (*will*). Keeping the two
 * apart matters — a room pasted onto the wrong provider must not re-enable video for someone who
 * doesn't do them, and a provider who does can still be paused without deleting their room.
 *
 * Read in the booking confirm path to clamp the requested modality, so the check runs against
 * the physician who actually owns the slot rather than the clinic-wide video setting.
 */
export async function physicianSupportsVideo(physicianId: string): Promise<boolean> {
  const res = await query<{ video_available: boolean }>(
    `SELECT (doxy_room_url IS NOT NULL AND doxy_room_url <> ''
             AND NOT video_visits_disabled) AS video_available
       FROM physicians WHERE id = $1`,
    [physicianId],
  );
  return res.rows[0]?.video_available === true;
}

/** The physician who owns a slot, scoped to the clinic. Null when the slot isn't theirs. */
export async function getSlotPhysicianId(
  slotId: string,
  organizationId: string,
): Promise<string | null> {
  const res = await query<{ physician_id: string }>(
    `SELECT physician_id FROM appointment_slots WHERE id = $1 AND organization_id = $2`,
    [slotId, organizationId],
  );
  return res.rows[0]?.physician_id ?? null;
}

/**
 * Return existing slots for a physician that overlap any of the given time
 * ranges (half-open intervals: they overlap when existingStart < rangeEnd and
 * rangeStart < existingEnd). Used to warn before creating overlapping slots.
 */
export async function findOverlappingSlots(
  orgId: string,
  physicianId: string,
  ranges: { start: Date; end: Date }[],
): Promise<{ startTime: string; endTime: string; status: string }[]> {
  if (ranges.length === 0) return [];
  const minStart = new Date(Math.min(...ranges.map((r) => r.start.getTime())));
  const maxEnd = new Date(Math.max(...ranges.map((r) => r.end.getTime())));

  const result = await query<{ start_time: Date; end_time: Date; status: string }>(
    `SELECT start_time, end_time, status
     FROM appointment_slots
     WHERE organization_id = $1 AND physician_id = $2
       AND status <> 'DELETED'
       AND start_time < $4::TIMESTAMPTZ AND end_time > $3::TIMESTAMPTZ
     ORDER BY start_time`,
    [orgId, physicianId, minStart.toISOString(), maxEnd.toISOString()],
  );

  return result.rows
    .filter((row) => {
      const s = row.start_time instanceof Date ? row.start_time.getTime() : new Date(row.start_time).getTime();
      const e = row.end_time instanceof Date ? row.end_time.getTime() : new Date(row.end_time).getTime();
      return ranges.some((r) => s < r.end.getTime() && r.start.getTime() < e);
    })
    .map((row) => ({
      startTime: row.start_time instanceof Date ? row.start_time.toISOString() : String(row.start_time),
      endTime: row.end_time instanceof Date ? row.end_time.toISOString() : String(row.end_time),
      status: row.status,
    }));
}

export async function createSlot(
  orgId: string,
  physicianId: string,
  startTime: string,
  endTime: string,
  status: "OPEN" | "BLOCKED" = "OPEN",
): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO appointment_slots (organization_id, physician_id, start_time, end_time, status)
     VALUES ($1, $2, $3::TIMESTAMPTZ, $4::TIMESTAMPTZ, $5)
     RETURNING id`,
    [orgId, physicianId, startTime, endTime, status],
  );
  return result.rows[0].id;
}

export async function updateSlotStatus(
  slotId: string,
  orgId: string,
  status: "OPEN" | "BLOCKED",
): Promise<boolean> {
  const result = await query(
    `UPDATE appointment_slots
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND organization_id = $3 AND status NOT IN ('BOOKED', 'HELD', 'DELETED')`,
    [status, slotId, orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteSlot(slotId: string, orgId: string): Promise<boolean> {
  try {
    const result = await query(
      `DELETE FROM appointment_slots
       WHERE id = $1 AND organization_id = $2 AND status IN ('OPEN', 'BLOCKED')`,
      [slotId, orgId],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    // A slot that was ever booked is still referenced by its (cancelled)
    // appointment row, so the FK blocks the hard delete. Soft-delete instead —
    // DELETED slots are excluded from every listing, and the appointment
    // history keeps its start/end times.
    if ((err as { code?: string })?.code !== "23503") throw err;
    const result = await query(
      `UPDATE appointment_slots
       SET status = 'DELETED', updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND status IN ('OPEN', 'BLOCKED')`,
      [slotId, orgId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

// ---------------------------------------------------------------------------
// Hold / confirm / cancel
// ---------------------------------------------------------------------------

export async function holdSlot(
  slotId: string,
  orgId: string,
  sessionKey: string,
  durationMinutes = 10,
): Promise<boolean> {
  await releaseExpiredHolds();

  const heldUntil = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
  const result = await query(
    `UPDATE appointment_slots
     SET status = 'HELD', held_until = $1::TIMESTAMPTZ, held_session_key = $2, updated_at = NOW()
     WHERE id = $3 AND organization_id = $4 AND status = 'OPEN'`,
    [heldUntil, sessionKey, slotId, orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export type ConfirmAppointmentData = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  coverageType: string;
  province?: string;
  healthCardNumber?: string;
  billingNote?: string;
  reason?: string;
  /** How this specific appointment happens. Null/undefined means "inherit the clinic setting". */
  appointmentModality?: string | null;
  /** Normalized to E.164 by the caller. Needed to text a video join link, and it *is* a phone visit. */
  patientPhone?: string | null;
  manageTokenHash: string;
  manageTokenExpiresAt: Date;
  oscarDemographicNo?: string;
  /**
   * Preferred pharmacy, already resolved server-side. For a directory pick these fields come from
   * pharmacy_directory by id, not from the client — see the confirm route. Stored here so the
   * choice survives even if the later link into OSCAR fails.
   */
  pharmacy?: {
    oscarPharmacyId?: string;
    name: string;
    address?: string;
    city?: string;
    phone?: string;
    fax?: string;
    source: "DIRECTORY" | "FREE_TEXT";
  };
  /** Patient's answer to the AI-scribe question. Null = not asked (stored as NULL). */
  aiScribeConsent?: boolean | null;
};

export async function confirmAppointment(
  slotId: string,
  orgId: string,
  sessionKey: string,
  data: ConfirmAppointmentData,
): Promise<{ appointmentId: string; physicianId: string } | null> {
  // Validate hold and create appointment in a single transaction
  const healthCardEnc = data.healthCardNumber
    ? encryptString(data.healthCardNumber)
    : null;

  let result;
  try {
    result = await query<{ appointment_id: string; physician_id: string }>(
      `WITH hold_check AS (
       SELECT id, physician_id, organization_id
       FROM appointment_slots
       WHERE id = $1
         AND organization_id = $2
         AND status = 'HELD'
         AND held_session_key = $3
         AND held_until > NOW()
       FOR UPDATE
     ),
     slot_update AS (
       UPDATE appointment_slots
       SET status = 'BOOKED', held_until = NULL, held_session_key = NULL, updated_at = NOW()
       WHERE id IN (SELECT id FROM hold_check)
       RETURNING physician_id
     ),
     appt_insert AS (
       INSERT INTO appointments
         (organization_id, physician_id, slot_id, first_name, last_name, date_of_birth,
          email, coverage_type, province, health_card_number_enc, billing_note, reason,
          manage_token_hash, manage_token_expires_at, oscar_demographic_no,
          pharmacy_oscar_id, pharmacy_name, pharmacy_address, pharmacy_city,
          pharmacy_phone, pharmacy_fax, pharmacy_source,
          appointment_modality, patient_phone, ai_scribe_consent)
       SELECT
         hc.organization_id, su.physician_id, hc.id, $4, $5, $6::DATE,
         $7, $8, $9, $10, $11, $12, $13, $14::TIMESTAMPTZ, $15,
         $16, $17, $18, $19, $20, $21, $22,
         $23, $24, $25
       FROM hold_check hc
       JOIN slot_update su ON TRUE
       RETURNING id AS appointment_id, physician_id
     )
     SELECT appointment_id, physician_id FROM appt_insert`,
      [
        slotId,
        orgId,
        sessionKey,
        data.firstName,
        data.lastName,
        data.dateOfBirth,
        data.email,
        data.coverageType,
        data.province ?? null,
        healthCardEnc,
        data.billingNote ?? null,
        data.reason ?? null,
        data.manageTokenHash,
        data.manageTokenExpiresAt.toISOString(),
        data.oscarDemographicNo ?? null,
        data.pharmacy?.oscarPharmacyId ?? null,
        data.pharmacy?.name ?? null,
        data.pharmacy?.address ?? null,
        data.pharmacy?.city ?? null,
        data.pharmacy?.phone ?? null,
        data.pharmacy?.fax ?? null,
        data.pharmacy?.source ?? null,
        data.appointmentModality ?? null,
        data.patientPhone ?? null,
        data.aiScribeConsent ?? null,
      ],
    );
  } catch (err) {
    // 23505 = unique_violation. This slot already has a live (non-cancelled)
    // appointment — e.g. a race where two sessions confirm the same slot, or a
    // slot left inconsistent (marked OPEN while still holding an active booking).
    // Treat it as "slot no longer available" (caller returns 409) rather than a
    // hard 500, so the patient gets a clear message instead of an empty error.
    if ((err as { code?: string }).code === "23505") {
      return null;
    }
    throw err;
  }

  const row = result.rows[0];
  if (!row) return null;
  return { appointmentId: row.appointment_id, physicianId: row.physician_id };
}

export async function getAppointmentByToken(tokenHash: string): Promise<AppointmentRow | null> {
  const result = await query<{
    id: string;
    organization_id: string;
    physician_id: string;
    p_first_name: string;
    p_last_name: string;
    p_online_booking_enabled: boolean;
    slot_id: string;
    start_time: Date;
    end_time: Date;
    first_name: string;
    last_name: string;
    date_of_birth: string;
    email: string;
    coverage_type: string;
    province: string | null;
    health_card_number_enc: string | null;
    billing_note: string | null;
    reason: string | null;
    manage_token_expires_at: Date;
    cancelled_at: Date | null;
    created_at: Date;
    oscar_sync_status: string | null;
    oscar_appointment_no: string | null;
    pharmacy_name: string | null;
    pharmacy_city: string | null;
    pharmacy_link_status: string | null;
    appointment_modality: string | null;
    patient_phone: string | null;
    ai_scribe_consent: boolean | null;
  }>(
    `SELECT
       a.id, a.organization_id, a.physician_id,
       ph.first_name AS p_first_name, ph.last_name AS p_last_name,
       ph.online_booking_enabled AS p_online_booking_enabled,
       a.slot_id,
       s.start_time, s.end_time,
       a.first_name, a.last_name, a.date_of_birth::TEXT, a.email,
       a.coverage_type, a.province, a.health_card_number_enc, a.billing_note, a.reason,
       a.manage_token_expires_at, a.cancelled_at, a.created_at, a.oscar_sync_status, a.oscar_appointment_no,
       a.pharmacy_name, a.pharmacy_city, a.pharmacy_link_status,
       a.appointment_modality, a.patient_phone, a.ai_scribe_consent
     FROM appointments a
     JOIN appointment_slots s ON s.id = a.slot_id
     JOIN physicians ph ON ph.id = a.physician_id
     WHERE a.manage_token_hash = $1`,
    [tokenHash],
  );

  const row = result.rows[0];
  if (!row) return null;

  let healthCardNumber: string | null = null;
  if (row.health_card_number_enc) {
    try {
      healthCardNumber = decryptString(row.health_card_number_enc);
    } catch {
      healthCardNumber = null;
    }
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    physicianId: row.physician_id,
    physicianFirstName: row.p_first_name,
    physicianLastName: row.p_last_name,
    physicianOnlineBookingEnabled: row.p_online_booking_enabled === true,
    slotId: row.slot_id,
    slotStartTime: row.start_time instanceof Date ? row.start_time.toISOString() : String(row.start_time),
    slotEndTime: row.end_time instanceof Date ? row.end_time.toISOString() : String(row.end_time),
    firstName: row.first_name,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    email: row.email,
    coverageType: row.coverage_type,
    province: row.province,
    healthCardNumber,
    billingNote: row.billing_note,
    reason: row.reason,
    appointmentModality: row.appointment_modality,
    patientPhone: row.patient_phone,
    manageTokenExpiresAt: row.manage_token_expires_at instanceof Date
      ? row.manage_token_expires_at.toISOString()
      : String(row.manage_token_expires_at),
    cancelledAt: row.cancelled_at
      ? (row.cancelled_at instanceof Date ? row.cancelled_at.toISOString() : String(row.cancelled_at))
      : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    oscarSyncStatus: row.oscar_sync_status,
    oscarAppointmentNo: row.oscar_appointment_no,
    pharmacyName: row.pharmacy_name,
    pharmacyCity: row.pharmacy_city,
    pharmacyLinkStatus: row.pharmacy_link_status,
    aiScribeConsent: row.ai_scribe_consent,
  };
}

export async function cancelAppointment(tokenHash: string): Promise<boolean> {
  const result = await query(
    `WITH appt AS (
       UPDATE appointments
       SET cancelled_at = NOW()
       WHERE manage_token_hash = $1
         AND cancelled_at IS NULL
       RETURNING slot_id
     )
     UPDATE appointment_slots
     SET status = 'OPEN', updated_at = NOW()
     WHERE id IN (SELECT slot_id FROM appt)`,
    [tokenHash],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getAppointmentsForOrg(
  orgId: string,
  opts: { physicianId?: string; dateFrom?: string; dateTo?: string },
): Promise<AppointmentRow[]> {
  const conditions: string[] = ["a.organization_id = $1"];
  const params: unknown[] = [orgId];
  let idx = 2;

  if (opts.physicianId) {
    conditions.push(`a.physician_id = $${idx++}`);
    params.push(opts.physicianId);
  }
  if (opts.dateFrom) {
    conditions.push(`s.start_time >= $${idx++}::TIMESTAMPTZ`);
    params.push(opts.dateFrom);
  }
  if (opts.dateTo) {
    conditions.push(`s.start_time < ($${idx++}::DATE + INTERVAL '1 day')::TIMESTAMPTZ`);
    params.push(opts.dateTo);
  }

  const result = await query<{
    id: string;
    organization_id: string;
    physician_id: string;
    p_first_name: string;
    p_last_name: string;
    p_online_booking_enabled: boolean;
    slot_id: string;
    start_time: Date;
    end_time: Date;
    first_name: string;
    last_name: string;
    date_of_birth: string;
    email: string;
    coverage_type: string;
    province: string | null;
    health_card_number_enc: string | null;
    billing_note: string | null;
    manage_token_expires_at: Date;
    cancelled_at: Date | null;
    created_at: Date;
    oscar_sync_status: string | null;
    oscar_appointment_no: string | null;
    pharmacy_name: string | null;
    pharmacy_city: string | null;
    pharmacy_link_status: string | null;
    reason: string | null;
    appointment_modality: string | null;
    patient_phone: string | null;
    ai_scribe_consent: boolean | null;
  }>(
    `SELECT
       a.id, a.organization_id, a.physician_id,
       ph.first_name AS p_first_name, ph.last_name AS p_last_name,
       ph.online_booking_enabled AS p_online_booking_enabled,
       a.slot_id, s.start_time, s.end_time,
       a.first_name, a.last_name, a.date_of_birth::TEXT, a.email,
       a.coverage_type, a.province, a.health_card_number_enc, a.billing_note, a.reason,
       a.manage_token_expires_at, a.cancelled_at, a.created_at, a.oscar_sync_status, a.oscar_appointment_no,
       a.pharmacy_name, a.pharmacy_city, a.pharmacy_link_status,
       a.appointment_modality, a.patient_phone, a.ai_scribe_consent
     FROM appointments a
     JOIN appointment_slots s ON s.id = a.slot_id
     JOIN physicians ph ON ph.id = a.physician_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY s.start_time DESC`,
    params,
  );

  // One batched follow-up rather than a JOIN: an appointment may have several files, and
  // joining would multiply every appointment row by its file count.
  //
  // Deliberately best-effort: attachments are an extra on this screen, but the screen itself is
  // how staff see their day. If migration 073 hasn't landed on this database yet, the missing
  // table must cost the paperclips, not the entire appointment list.
  const attachmentsByAppointment = new Map<string, AppointmentAttachment[]>();
  if (result.rows.length) {
    try {
      const files = await query<{
        id: string;
        appointment_id: string;
        original_filename: string | null;
        content_type: string | null;
      }>(
        `SELECT id, appointment_id, original_filename, content_type
         FROM appointment_files
         WHERE appointment_id = ANY($1::uuid[])
         ORDER BY uploaded_at`,
        [result.rows.map((r) => r.id)],
      );
      for (const f of files.rows) {
        const list = attachmentsByAppointment.get(f.appointment_id) ?? [];
        list.push({ id: f.id, filename: f.original_filename, contentType: f.content_type });
        attachmentsByAppointment.set(f.appointment_id, list);
      }
    } catch (err) {
      console.error("[booking-store] Could not load appointment attachments:", err);
    }
  }

  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    physicianId: row.physician_id,
    physicianFirstName: row.p_first_name,
    physicianLastName: row.p_last_name,
    physicianOnlineBookingEnabled: row.p_online_booking_enabled === true,
    slotId: row.slot_id,
    slotStartTime: row.start_time instanceof Date ? row.start_time.toISOString() : String(row.start_time),
    slotEndTime: row.end_time instanceof Date ? row.end_time.toISOString() : String(row.end_time),
    firstName: row.first_name,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    email: row.email,
    coverageType: row.coverage_type,
    province: row.province,
    healthCardNumber: null, // not decrypted in list view
    attachments: attachmentsByAppointment.get(row.id) ?? [],
    billingNote: row.billing_note,
    reason: row.reason,
    appointmentModality: row.appointment_modality,
    patientPhone: row.patient_phone,
    manageTokenExpiresAt: row.manage_token_expires_at instanceof Date
      ? row.manage_token_expires_at.toISOString()
      : String(row.manage_token_expires_at),
    cancelledAt: row.cancelled_at
      ? (row.cancelled_at instanceof Date ? row.cancelled_at.toISOString() : String(row.cancelled_at))
      : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    oscarSyncStatus: row.oscar_sync_status,
    oscarAppointmentNo: row.oscar_appointment_no,
    pharmacyName: row.pharmacy_name,
    pharmacyCity: row.pharmacy_city,
    pharmacyLinkStatus: row.pharmacy_link_status,
    aiScribeConsent: row.ai_scribe_consent,
  }));
}

// ---------------------------------------------------------------------------
// Clinics with booking enabled (for landing page)
// ---------------------------------------------------------------------------

export async function getBookingEnabledClinics(): Promise<
  { id: string; name: string; slug: string; address: string | null }[]
> {
  const result = await query<{
    id: string;
    name: string;
    slug: string;
    business_address: string | null;
  }>(
    `SELECT o.id, o.name, o.slug, o.business_address
     FROM organizations o
     JOIN booking_settings bs ON bs.organization_id = o.id
     WHERE o.slug IS NOT NULL
       AND bs.online_booking_enabled = TRUE
     ORDER BY o.name`,
  );

  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    address: r.business_address,
  }));
}
