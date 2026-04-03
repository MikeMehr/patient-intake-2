/**
 * Database query helpers for the online booking system.
 */

import { query } from "@/lib/db";
import { encryptString, decryptString } from "@/lib/encrypted-field";

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
  cancellationPolicy: string | null;
  bookingInstructions: string | null;
  timezone: string;
};

export type ClinicInfo = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
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
};

export type AppointmentRow = {
  id: string;
  organizationId: string;
  physicianId: string;
  physicianFirstName: string;
  physicianLastName: string;
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
  manageTokenExpiresAt: string;
  cancelledAt: string | null;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Clinic / settings lookups
// ---------------------------------------------------------------------------

export async function getClinicBySlug(slug: string): Promise<ClinicInfo | null> {
  const result = await query<{
    id: string;
    name: string;
    slug: string;
    business_address: string | null;
    phone: string | null;
    bs_id: string | null;
    online_booking_enabled: boolean | null;
    public_booking_start: string | null;
    public_booking_end: string | null;
    enforce_booking_window: boolean | null;
    slot_interval_minutes: number | null;
    health_card_required: boolean | null;
    show_blocked_slots: boolean | null;
    cancellation_policy: string | null;
    booking_instructions: string | null;
    timezone: string | null;
  }>(
    `SELECT
       o.id, o.name, o.slug, o.business_address, o.phone,
       bs.id                    AS bs_id,
       bs.online_booking_enabled,
       bs.public_booking_start::TEXT,
       bs.public_booking_end::TEXT,
       bs.enforce_booking_window,
       bs.slot_interval_minutes,
       bs.health_card_required,
       bs.show_blocked_slots,
       bs.cancellation_policy,
       bs.booking_instructions,
       bs.timezone
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
    address: row.business_address,
    phone: row.phone,
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
          cancellationPolicy: row.cancellation_policy,
          bookingInstructions: row.booking_instructions,
          timezone: row.timezone ?? "America/Vancouver",
        }
      : null,
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
    cancellation_policy: string | null;
    booking_instructions: string | null;
    timezone: string;
  }>(
    `SELECT id, online_booking_enabled,
            public_booking_start::TEXT, public_booking_end::TEXT,
            enforce_booking_window, slot_interval_minutes,
            health_card_required, show_blocked_slots,
            cancellation_policy, booking_instructions, timezone
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
    cancellationPolicy: row.cancellation_policy,
    bookingInstructions: row.booking_instructions,
    timezone: row.timezone,
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
       booking_instructions, timezone, updated_at)
     VALUES ($1,
       COALESCE($2, FALSE), COALESCE($3, '07:00')::TIME, COALESCE($4, '22:00')::TIME,
       COALESCE($5, TRUE), COALESCE($6, 15), COALESCE($7, FALSE), COALESCE($8, FALSE),
       $9, $10, COALESCE($11, 'America/Vancouver'), NOW())
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
  },
): Promise<AppointmentSlot[]> {
  await releaseExpiredHolds();

  const conditions: string[] = [
    "s.organization_id = $1",
    "s.start_time >= $2::TIMESTAMPTZ",
    "s.start_time < ($3::DATE + INTERVAL '1 day')::TIMESTAMPTZ",
  ];
  const params: unknown[] = [orgId, opts.dateFrom, opts.dateTo];
  let idx = 4;

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
  }>(
    `SELECT s.id, s.organization_id, s.physician_id,
            p.first_name, p.last_name,
            s.start_time, s.end_time, s.status
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
     WHERE id = $2 AND organization_id = $3 AND status NOT IN ('BOOKED', 'HELD')`,
    [status, slotId, orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteSlot(slotId: string, orgId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM appointment_slots
     WHERE id = $1 AND organization_id = $2 AND status IN ('OPEN', 'BLOCKED')`,
    [slotId, orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Hold / confirm / cancel
// ---------------------------------------------------------------------------

export async function holdSlot(
  slotId: string,
  orgId: string,
  sessionKey: string,
  durationMinutes = 5,
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
  manageTokenHash: string;
  manageTokenExpiresAt: Date;
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

  const result = await query<{ appointment_id: string; physician_id: string }>(
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
          email, coverage_type, province, health_card_number_enc, billing_note,
          manage_token_hash, manage_token_expires_at)
       SELECT
         hc.organization_id, su.physician_id, hc.id, $4, $5, $6::DATE,
         $7, $8, $9, $10, $11, $12, $13::TIMESTAMPTZ
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
      data.manageTokenHash,
      data.manageTokenExpiresAt.toISOString(),
    ],
  );

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
  }>(
    `SELECT
       a.id, a.organization_id, a.physician_id,
       ph.first_name AS p_first_name, ph.last_name AS p_last_name,
       a.slot_id,
       s.start_time, s.end_time,
       a.first_name, a.last_name, a.date_of_birth::TEXT, a.email,
       a.coverage_type, a.province, a.health_card_number_enc, a.billing_note,
       a.manage_token_expires_at, a.cancelled_at, a.created_at
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
    manageTokenExpiresAt: row.manage_token_expires_at instanceof Date
      ? row.manage_token_expires_at.toISOString()
      : String(row.manage_token_expires_at),
    cancelledAt: row.cancelled_at
      ? (row.cancelled_at instanceof Date ? row.cancelled_at.toISOString() : String(row.cancelled_at))
      : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
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
  }>(
    `SELECT
       a.id, a.organization_id, a.physician_id,
       ph.first_name AS p_first_name, ph.last_name AS p_last_name,
       a.slot_id, s.start_time, s.end_time,
       a.first_name, a.last_name, a.date_of_birth::TEXT, a.email,
       a.coverage_type, a.province, a.health_card_number_enc, a.billing_note,
       a.manage_token_expires_at, a.cancelled_at, a.created_at
     FROM appointments a
     JOIN appointment_slots s ON s.id = a.slot_id
     JOIN physicians ph ON ph.id = a.physician_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY s.start_time DESC`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    physicianId: row.physician_id,
    physicianFirstName: row.p_first_name,
    physicianLastName: row.p_last_name,
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
    billingNote: row.billing_note,
    manageTokenExpiresAt: row.manage_token_expires_at instanceof Date
      ? row.manage_token_expires_at.toISOString()
      : String(row.manage_token_expires_at),
    cancelledAt: row.cancelled_at
      ? (row.cancelled_at instanceof Date ? row.cancelled_at.toISOString() : String(row.cancelled_at))
      : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
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
