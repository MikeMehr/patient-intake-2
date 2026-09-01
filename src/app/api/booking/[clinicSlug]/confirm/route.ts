/**
 * POST /api/booking/[clinicSlug]/confirm
 * Validates the hold, creates the appointment, sends confirmation email.
 *
 * Body: {
 *   slotId, firstName, lastName, dateOfBirth, email, reason?, coverageType,
 *   province?, healthCardNumber?, billingNote?, consentGiven
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { isBookingBlocked } from "@/lib/booking-blocks";
import {
  getClinicBySlug,
  getPhysiciansForBooking,
  confirmAppointment,
  getSlotPhysicianId,
  physicianSupportsVideo,
} from "@/lib/booking-store";
import { generateManageToken } from "@/lib/booking-token";
import { sendBookingConfirmation } from "@/lib/booking-email";
import { sendBookingAlertSMS, toE164 } from "@/lib/sms";
import { describeMspEligibilityChecked, type ChartCard } from "@/lib/billing/msp-eligibility";
import { checkMspCoverage } from "@/lib/oscar/msp-coverage";
import { bookingCardMessage, checkBookingHealthCard } from "@/lib/billing/booking-msp-gate";
import {
  normalizeModality,
  type AppointmentModality,
} from "@/lib/appointment-modality";
import {
  buildOscarAppointmentNotes,
} from "@/lib/oscar/appointment-notes";
import { getPhysicianPhone } from "@/lib/physician-lookup";
import { getOscarCredsForOrg } from "@/lib/oscar/self-serve";
import { fetchOscarDemographic } from "@/lib/oscar/demographics";
import { query } from "@/lib/db";
import { decryptString } from "@/lib/encrypted-field";
import { createOscarAppointment, toClinicLocalParts } from "@/lib/oscar/appointments";
import { isPharmacyUpsertEnabled, linkOscarPharmacy, upsertOscarPharmacy } from "@/lib/oscar/pharmacy";
import { findPharmacyByNameCity, getPharmacyFromDirectory } from "@/lib/pharmacy-directory";
import { normalizePharmacySelection, type PharmacySelection } from "@/lib/pharmacy-selection";

export const runtime = "nodejs";

const HOLD_COOKIE = "booking_hold_key";
const COVERAGE_TYPES = [
  "CANADIAN_HEALTH_CARD",
  "PRIVATE_PAY",
  "TRAVEL_INSURANCE",
  "UNINSURED",
  "EXISTING_OSCAR_PATIENT",
] as const;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;
// OSCAR's appointment.reason column is varchar(80).
const MAX_REASON_LEN = 80;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  try {
    return await handleConfirm(req, await params);
  } catch (err) {
    // Last-resort guard: never return an empty-body 500. The client does
    // `await res.json()` on the response, which itself throws if the body is
    // empty, masking the real error. Always emit JSON.
    console.error("[confirm] Unhandled error:", err);
    return NextResponse.json(
      { error: "Something went wrong while confirming your appointment. Please try again." },
      { status: 500 },
    );
  }
}

async function handleConfirm(
  req: NextRequest,
  { clinicSlug }: { clinicSlug: string },
) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    slotId,
    firstName,
    lastName,
    dateOfBirth,
    email,
    reason,
    coverageType,
    province,
    healthCardNumber,
    billingNote,
    consentGiven,
    oscarDemographicNo,
    appointmentModality,
    phone,
    aiScribeConsent,
  } = body as Record<string, string | boolean | undefined>;

  // AI-scribe answer is tri-state. Strict boolean check: anything else (a form loaded before
  // this deploy, or junk from a hand-rolled request) stores NULL = "not asked" — never a
  // fabricated yes.
  const aiScribe: boolean | null =
    typeof aiScribeConsent === "boolean" ? aiScribeConsent : null;

  // Preferred pharmacy is optional and must never be able to fail a booking, so an unusable value
  // normalizes to null rather than 400.
  const pharmacySelection = normalizePharmacySelection(body.pharmacy);

  // Reason for visit. The form marks this required, but don't 400 when it's
  // absent: a patient who loaded the form before a deploy would submit without
  // it, and by this point their OSCAR chart may already have been created.
  // Fall back to the old label instead. Capped to OSCAR's varchar(80).
  //
  // Angle brackets are stripped because this text is anonymous public input that
  // OSCAR renders into its day sheet HTML. Escaping there is the real defence;
  // this is belt-and-braces that survives an OSCAR redeploy.
  const reasonText = String(reason ?? "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_REASON_LEN);
  const oscarReason = reasonText || "Online booking";

  // Validate required fields
  if (!slotId || !firstName || !lastName || !dateOfBirth || !email || !coverageType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!DOB_RE.test(String(dateOfBirth))) {
    return NextResponse.json({ error: "dateOfBirth must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!COVERAGE_TYPES.includes(coverageType as (typeof COVERAGE_TYPES)[number])) {
    return NextResponse.json({ error: "Invalid coverageType" }, { status: 400 });
  }
  if (!consentGiven) {
    return NextResponse.json({ error: "Patient consent is required" }, { status: 400 });
  }

  // Read hold session key from cookie
  const sessionKey = req.cookies.get(HOLD_COOKIE)?.value;
  if (!sessionKey) {
    return NextResponse.json(
      { error: "No active hold found. Please select a slot again." },
      { status: 409 },
    );
  }

  const clinic = await getClinicBySlug(clinicSlug);
  if (!clinic || !clinic.settings?.onlineBookingEnabled) {
    return NextResponse.json({ error: "Clinic not found or booking not enabled" }, { status: 404 });
  }

  // Server-side copy of the per-patient block. lookup-patient never hands a blocked
  // patient their demographicNo, but this field arrives from the client, so a
  // hand-rolled POST could otherwise skip the screen.
  if (oscarDemographicNo && (await isBookingBlocked(clinic.id, String(oscarDemographicNo)))) {
    return NextResponse.json(
      {
        error:
          "Online booking is not available for your patient record. Please email the clinic to book an appointment." +
          (clinic.email ? ` Contact: ${clinic.email}` : ""),
      },
      { status: 403 },
    );
  }

  // How this appointment happens. The clinic setting is the default; the patient may only move
  // off it when the clinic has actually turned that on. Clamped server-side rather than trusted:
  // this is an anonymous public form, and without the clamp anyone could book a video visit at a
  // clinic that doesn't do them, or that has video switched off pending a Daily account.
  //
  // The clinic-wide check is not enough on its own. Doxy rooms belong to a provider and cannot be
  // created on demand, so a provider without one has nowhere to put the patient — the booking
  // succeeds, the confirmation email says a waiting-room link is coming, and none ever arrives.
  // That happened to a real patient on 2026-08-08. So the slot's own physician gets the final say.
  const requestedModality = normalizeModality(appointmentModality);
  const clinicAllowsRequested =
    clinic.settings.patientMayChooseModality &&
    (requestedModality !== "VIDEO" || clinic.settings.videoVisitsEnabled);
  const slotPhysicianId = await getSlotPhysicianId(String(slotId), clinic.id);
  const physicianAllowsRequested =
    requestedModality !== "VIDEO" ||
    (slotPhysicianId !== null && (await physicianSupportsVideo(slotPhysicianId)));
  const effectiveModality: AppointmentModality =
    clinicAllowsRequested && physicianAllowsRequested
      ? requestedModality
      // Falling back to the clinic default would re-select VIDEO at a clinic whose default is
      // video, which is the case being guarded against. PHONE is the only always-deliverable
      // format: every booking already collects a phone number.
      : requestedModality === "VIDEO" && !physicianAllowsRequested
        ? "PHONE"
        : clinic.settings.appointmentModality;

  // The patient's phone was previously collected only on the "not found in OSCAR" branch and
  // forwarded to demographic creation without ever being kept. A video visit needs it to text a
  // join link, and a phone visit is nothing but it.
  const patientPhone = phone ? toE164(String(phone)) : null;
  const storedPhone = patientPhone && /^\+\d{10,15}$/.test(patientPhone) ? patientPhone : null;

  // Enforce the health card requirement (not applicable to existing Oscar patients, who book with
  // coverageType EXISTING_OSCAR_PATIENT and whose card is whatever the chart already says).
  //
  // The number has to be a card the clinic can actually bill, not merely present: this form is
  // anonymous and public, so a booking that reaches here with an unbillable PHN is a visit nobody
  // gets paid for and a chart someone has to clean up. The browser runs the same check before the
  // OSCAR chart is created — this is the copy that a hand-rolled request cannot skip.
  if (clinic.settings.healthCardRequired) {
    const gate = checkBookingHealthCard({
      coverageType: String(coverageType),
      province: province != null ? String(province) : null,
      healthCardNumber: healthCardNumber != null ? String(healthCardNumber) : null,
      lastName: lastName != null ? String(lastName) : null,
    });
    if (!gate.ok) {
      return NextResponse.json(
        { error: bookingCardMessage(gate, clinic.email) },
        { status: 400 },
      );
    }
  }

  const { raw: manageTokenRaw, hash: manageTokenHash, expiresAt: manageTokenExpiresAt } =
    generateManageToken();

  // Resolve the pharmacy BEFORE the insert so the snapshot is committed with the booking. A
  // directory pick is re-read from our own table by id and the client's other fields are
  // discarded — otherwise this public form would be a way to write an arbitrary fax number
  // (where prescriptions get sent) onto a chart.
  const pharmacyRecord = await resolvePharmacyForBooking(clinic.id, pharmacySelection);

  const result = await confirmAppointment(String(slotId), clinic.id, sessionKey, {
    firstName: String(firstName),
    lastName: String(lastName),
    dateOfBirth: String(dateOfBirth),
    email: String(email),
    coverageType: String(coverageType),
    province: province ? String(province) : undefined,
    healthCardNumber: healthCardNumber ? String(healthCardNumber) : undefined,
    billingNote: billingNote ? String(billingNote) : undefined,
    reason: reasonText || undefined,
    manageTokenHash,
    manageTokenExpiresAt,
    oscarDemographicNo: oscarDemographicNo ? String(oscarDemographicNo) : undefined,
    pharmacy: pharmacyRecord ?? undefined,
    appointmentModality: effectiveModality,
    patientPhone: storedPhone,
    aiScribeConsent: aiScribe,
  });

  if (!result) {
    return NextResponse.json(
      { error: "Your hold has expired or the slot is no longer available. Please start over." },
      { status: 409 },
    );
  }

  // Fetch physician name for email
  const physicians = await getPhysiciansForBooking(clinic.id);
  const physician = physicians.find((p) => p.id === result.physicianId);

  // Fetch slot start/end time for email + OSCAR sync
  const slotRow = await query<{ start_time: Date; end_time: Date }>(
    "SELECT start_time, end_time FROM appointment_slots WHERE id = $1",
    [slotId],
  );
  const slotStart = slotRow.rows[0]?.start_time ?? null;
  const slotEnd = slotRow.rows[0]?.end_time ?? null;
  const slotStartTime = slotStart?.toISOString() ?? "";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://physician.health-assist.org";

  // For a video visit, create the room now so the confirmation email can carry a join link.
  // Deliberately fail-soft: a Daily outage must not fail a booking that is already committed,
  // and the provider's day-sheet button creates the room on demand anyway. The patient then
  // gets their link from the manage page or from the provider.
  // The provider's permanent Doxy waiting room, if the clinic uses one. Doxy has no API and no
  // per-visit link — one room per provider, and the patient waits in it until admitted — so this
  // is simply looked up rather than created.
  let doxyRoomUrl: string | null = null;
  if (effectiveModality === "VIDEO") {
    const dr = await query<{ doxy_room_url: string | null }>(
      `SELECT doxy_room_url FROM physicians WHERE id = $1`,
      [result.physicianId],
    );
    doxyRoomUrl = dr.rows[0]?.doxy_room_url ?? null;
  }

  // Best-effort: push the booked appointment into OSCAR so it appears on the
  // provider's day sheet. Never block the booking — it's already committed.
  await syncAppointmentToOscar({
    appointmentId: result.appointmentId,
    physicianId: result.physicianId,
    organizationId: clinic.id,
    timezone: clinic.settings.timezone,
    slotStart,
    slotEnd,
    demographicNo: oscarDemographicNo ? String(oscarDemographicNo) : undefined,
    patientFirstName: String(firstName),
    patientLastName: String(lastName),
    reason: oscarReason,
    modality: effectiveModality,
    // Keyed on our appointment id, not the OSCAR appointment number: the note is written as
    // part of creating that appointment, so its number doesn't exist yet, and OSCAR publishes
    // no way to amend a note afterwards (verified against the live WADL 2026-08-01).
    videoLaunchUrl:
      effectiveModality === "VIDEO" ? doxyRoomUrl : null,
    aiScribeConsent: aiScribe,
  });

  // Best-effort: set the chosen pharmacy as preferred on the OSCAR chart. Like the sync above,
  // this runs after the booking is committed and can only annotate it.
  await linkPharmacyToOscar({
    appointmentId: result.appointmentId,
    organizationId: clinic.id,
    demographicNo: oscarDemographicNo ? String(oscarDemographicNo) : undefined,
    pharmacy: pharmacyRecord,
  });

  const manageUrl = `${appUrl}/booking/manage/${manageTokenRaw}`;

  // Send confirmation email (best-effort, don't fail booking if email fails)
  try {
    await sendBookingConfirmation({
      email: String(email),
      patientFirstName: String(firstName),
      clinicName: clinic.name,
      physicianName: physician?.displayName ?? "",
      slotStartTime,
      slotEndTime: "",
      timezone: clinic.settings.timezone,
      manageUrl,
      emailFooter: clinic.settings.emailFooter,
      clinicEmail: clinic.email,
      appointmentModality: effectiveModality,
      doxyRoomUrl,
    });
  } catch {
    // Email failure is non-fatal — appointment is already committed
  }

  // Notify the physician by SMS (best-effort, never blocks the booking)
  try {
    const physicianPhone = await getPhysicianPhone(result.physicianId);
    if (physicianPhone) {
      const dateLabel = slotStart
        ? new Intl.DateTimeFormat("en-CA", {
            timeZone: clinic.settings.timezone,
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }).format(slotStart)
        : "";
      // A returning patient is never asked for a health card — theirs is already on the chart —
      // so the only way to say more than "see chart" is to go and read it. The same read supplies
      // a phone number for anyone who booked before the form started asking returning patients
      // for one. Runs after the booking is committed and cannot fail it.
      const chart =
        String(coverageType) === "EXISTING_OSCAR_PATIENT" && oscarDemographicNo
          ? await readOscarChartContact(clinic.id, String(oscarDemographicNo))
          : { card: null, phone: null };

      await sendBookingAlertSMS(physicianPhone, {
        patientName: `${firstName} ${lastName}`,
        clinicName: clinic.name,
        dateLabel,
        // Already sanitized and capped to MAX_REASON_LEN above; empty means the
        // patient booked before the field existed, and the line is dropped.
        reason: reasonText || undefined,
        // storedPhone, not the raw field: only a well-formed E.164 number is worth
        // texting to a physician who may dial it. What the patient just typed wins over the
        // chart, which may be years old.
        patientPhone: storedPhone ?? chart.phone ?? undefined,
        // A card that passes its check digit is then put to MSP for real (Teleplan E45 via the
        // OSCAR bridge): a lapsed patient carries a perfectly valid PHN, and only MSP knows the
        // difference. When the bridge can't answer, the verdict says "coverage unverified"
        // rather than promising an eligibility nobody checked.
        mspStatus: await describeMspEligibilityChecked({
          coverageType: String(coverageType),
          province: province ? String(province) : null,
          healthCardNumber: healthCardNumber ? String(healthCardNumber) : null,
          chartCard: chart.card,
          dateOfBirth: String(dateOfBirth),
          checkCoverage: (args) => checkMspCoverage(clinic.id, args),
        }),
      });
    }
  } catch {
    // SMS failure is non-fatal — appointment is already committed
  }

  const response = NextResponse.json({
    success: true,
    appointmentId: result.appointmentId,
    manageToken: manageTokenRaw,
    manageUrl,
  });

  // Clear the hold cookie
  response.cookies.set(HOLD_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}

/**
 * Read the health card and phone number OSCAR already holds for a returning patient.
 *
 * Both are things this booking never collects on the returning-patient path, so the chart is the
 * only source. Every failure — no OSCAR connection, OSCAR unreachable, a chart that has gone away
 * — comes back as nulls, and the physician's text falls back to exactly what it said before.
 * Nothing here is allowed to throw: the appointment is already committed by the time it runs.
 */
async function readOscarChartContact(
  orgId: string,
  demographicNo: string,
): Promise<{ card: ChartCard | null; phone: string | null }> {
  const empty = { card: null, phone: null };
  try {
    const creds = await getOscarCredsForOrg(orgId);
    if (!creds) return empty;

    const fetched = await fetchOscarDemographic(creds, demographicNo);
    if (!fetched.ok) return empty;

    const { insuranceNumber, healthCardType, primaryPhone, secondaryPhone } = fetched.demographic;
    // toE164 hands back anything it doesn't recognize unchanged, so the shape is re-checked —
    // same guard the typed-in number gets before it reaches a physician who may dial it.
    const phone = toE164(primaryPhone ?? secondaryPhone ?? "");
    return {
      card: { hin: insuranceNumber, hcType: healthCardType },
      phone: /^\+\d{10,15}$/.test(phone) ? phone : null,
    };
  } catch {
    return empty;
  }
}

/**
 * Best-effort creation of the appointment in OSCAR's schedule, recording the
 * outcome on the appointments row (oscar_sync_status). This never throws — a
 * failure here only flags the appointment as not-synced so staff can enter it
 * manually; the patient's booking has already been committed.
 */
async function syncAppointmentToOscar(args: {
  appointmentId: string;
  physicianId: string;
  organizationId: string;
  timezone: string;
  slotStart: Date | null;
  slotEnd: Date | null;
  demographicNo?: string;
  patientFirstName: string;
  patientLastName: string;
  reason: string;
  modality: AppointmentModality;
  videoLaunchUrl: string | null;
  aiScribeConsent: boolean | null;
}): Promise<void> {
  const setSync = async (status: "SYNCED" | "FAILED" | "SKIPPED", apptNo: string | null, err: string | null) => {
    try {
      await query(
        `UPDATE appointments SET oscar_sync_status = $1, oscar_appointment_no = $2, oscar_sync_error = $3 WHERE id = $4`,
        [status, apptNo, err, args.appointmentId],
      );
    } catch {
      // Flag write is itself best-effort.
    }
  };

  try {
    if (!args.demographicNo || !/^\d+$/.test(args.demographicNo)) {
      console.error(`[confirm] OSCAR sync skipped — no demographicNo for appointment ${args.appointmentId}`);
      await setSync("SKIPPED", null, "No OSCAR patient (demographic) number");
      return;
    }
    if (!args.slotStart || !args.slotEnd) {
      await setSync("SKIPPED", null, "Slot times unavailable");
      return;
    }

    // Physician → OSCAR provider number
    const physRow = await query<{ oscar_provider_no: string | null }>(
      `SELECT oscar_provider_no FROM physicians WHERE id = $1`,
      [args.physicianId],
    );
    const providerNo = physRow.rows[0]?.oscar_provider_no?.trim();
    if (!providerNo) {
      console.error(`[confirm] OSCAR sync skipped — physician ${args.physicianId} has no oscar_provider_no`);
      await setSync("SKIPPED", null, "Physician has no OSCAR provider number");
      return;
    }

    // Org OSCAR connection
    const connRes = await query<{
      base_url: string;
      client_key: string;
      client_secret_enc: string;
      access_token_enc: string | null;
      token_secret_enc: string | null;
      status: string;
    }>(
      `SELECT base_url, client_key, client_secret_enc, access_token_enc, token_secret_enc, status
       FROM emr_connections
       WHERE organization_id = $1 AND vendor = 'OSCAR'
       LIMIT 1`,
      [args.organizationId],
    );
    const conn = connRes.rows[0];
    if (!conn || conn.status !== "connected" || !conn.access_token_enc || !conn.token_secret_enc) {
      await setSync("SKIPPED", null, "OSCAR not connected for this clinic");
      return;
    }

    const { date, time } = toClinicLocalParts(args.slotStart, args.timezone);
    const durationMinutes = Math.max(
      1,
      Math.round((args.slotEnd.getTime() - args.slotStart.getTime()) / 60000),
    );

    const res = await createOscarAppointment({
      oscarBaseUrl: conn.base_url,
      creds: {
        clientKey: conn.client_key,
        clientSecret: decryptString(conn.client_secret_enc),
        accessToken: decryptString(conn.access_token_enc),
        tokenSecret: decryptString(conn.token_secret_enc),
      },
      providerNo,
      demographicNo: Number(args.demographicNo),
      appointmentDate: date,
      startTime: time,
      durationMinutes,
      name: `${args.patientLastName}, ${args.patientFirstName}`,
      reason: args.reason,
      notes: buildOscarAppointmentNotes({
        modality: args.modality,
        videoLaunchUrl: args.videoLaunchUrl,
        aiScribeConsent: args.aiScribeConsent,
      }),
    });

    if (res.ok) {
      await setSync("SYNCED", res.appointmentNo, null);
    } else {
      console.error(`[confirm] OSCAR appointment create failed (${res.status}) for appointment ${args.appointmentId}`);
      await setSync("FAILED", null, `OSCAR ${res.status}: ${res.detail.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("[confirm] OSCAR sync unexpected error:", err);
    await setSync("FAILED", null, "Unexpected error during OSCAR sync");
  }
}

type ResolvedPharmacy = NonNullable<Parameters<typeof confirmAppointment>[3]["pharmacy"]>;

/**
 * Turn the patient's selection into the record stored on the appointment.
 *
 * A DIRECTORY pick is re-read from pharmacy_directory by id: the client is trusted for the id
 * alone, never for the name, address or fax. If that id isn't in our mirror (a stale tab after a
 * sync deactivated the row), it degrades to FREE_TEXT rather than being dropped, so staff still
 * see what the patient asked for.
 *
 * FREE_TEXT gets one chance to become a real link — an exact name+city match against the mirror —
 * because "Shoppers Drug Mart / Burnaby" typed by hand is the same pharmacy as the directory row.
 */
async function resolvePharmacyForBooking(
  orgId: string,
  selection: PharmacySelection | null,
): Promise<ResolvedPharmacy | null> {
  if (!selection) return null;

  if (selection.source === "DIRECTORY") {
    const row = await getPharmacyFromDirectory(orgId, selection.pharmacyId);
    if (row) {
      return {
        oscarPharmacyId: row.oscarPharmacyId,
        name: row.name,
        address: row.address ?? undefined,
        city: row.city ?? undefined,
        phone: row.phone ?? undefined,
        fax: row.fax ?? undefined,
        source: "DIRECTORY",
      };
    }
    console.error(
      `[confirm] pharmacy ${selection.pharmacyId} not in directory for org ${orgId} — storing as free text`,
    );
    return { name: selection.name, city: selection.city, source: "FREE_TEXT" };
  }

  const matched = await findPharmacyByNameCity(orgId, selection.name, selection.city);
  if (matched) {
    return {
      oscarPharmacyId: matched.oscarPharmacyId,
      name: matched.name,
      address: matched.address ?? undefined,
      city: matched.city ?? undefined,
      phone: matched.phone ?? undefined,
      fax: matched.fax ?? undefined,
      source: "DIRECTORY",
    };
  }

  return {
    name: selection.name,
    address: selection.address,
    city: selection.city,
    phone: selection.phone,
    fax: selection.fax,
    source: "FREE_TEXT",
  };
}

/**
 * Best-effort: make the chosen pharmacy the patient's preferred one in OSCAR, recording the
 * outcome on the appointments row (pharmacy_link_status). Never throws — the booking is already
 * committed, and a failure here only flags the row for staff.
 *
 * A free-text pharmacy is deliberately left SKIPPED unless PHARMACY_BRIDGE_ALLOW_UPSERT is on:
 * creating rows in OSCAR's shared pharmacy table from anonymous public input would put a
 * patient-supplied fax number in front of every clinician's Rx picker.
 */
async function linkPharmacyToOscar(args: {
  appointmentId: string;
  organizationId: string;
  demographicNo?: string;
  pharmacy: ResolvedPharmacy | null;
}): Promise<void> {
  if (!args.pharmacy) return; // No pharmacy chosen — leave the status NULL, make no call.

  const setPharmacyLink = async (
    status: "LINKED" | "FAILED" | "SKIPPED",
    pharmacyId: string | null,
    err: string | null,
  ) => {
    try {
      await query(
        `UPDATE appointments
         SET pharmacy_link_status = $1,
             pharmacy_oscar_id = COALESCE($2, pharmacy_oscar_id),
             pharmacy_link_error = $3
         WHERE id = $4`,
        [status, pharmacyId, err, args.appointmentId],
      );
    } catch {
      // Flag write is itself best-effort.
    }
  };

  try {
    if (!args.demographicNo || !/^\d+$/.test(args.demographicNo)) {
      await setPharmacyLink("SKIPPED", null, "No OSCAR patient (demographic) number");
      return;
    }

    let pharmacyId = args.pharmacy.oscarPharmacyId ?? null;

    if (!pharmacyId) {
      if (!isPharmacyUpsertEnabled()) {
        await setPharmacyLink("SKIPPED", null, "Free-text pharmacy — staff must link manually");
        return;
      }
      const created = await upsertOscarPharmacy(args.organizationId, {
        name: args.pharmacy.name,
        address: args.pharmacy.address,
        city: args.pharmacy.city,
        phone: args.pharmacy.phone,
        fax: args.pharmacy.fax,
      });
      if ("error" in created) {
        await setPharmacyLink("FAILED", null, `Create pharmacy: ${created.error.slice(0, 200)}`);
        return;
      }
      pharmacyId = created.pharmacyId;
    }

    const linked = await linkOscarPharmacy(args.organizationId, {
      demographicNo: args.demographicNo,
      pharmacyId,
    });
    if ("error" in linked) {
      console.error(
        `[confirm] pharmacy link failed for appointment ${args.appointmentId}: ${linked.error}`,
      );
      await setPharmacyLink("FAILED", pharmacyId, `Bridge ${linked.status}: ${linked.error.slice(0, 200)}`);
      return;
    }

    await setPharmacyLink("LINKED", pharmacyId, null);
  } catch (err) {
    console.error("[confirm] pharmacy link unexpected error:", err);
    await setPharmacyLink("FAILED", null, "Unexpected error during pharmacy link");
  }
}
