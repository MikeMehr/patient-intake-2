/**
 * What goes in an OSCAR appointment's `notes` field for a booking made through this app.
 *
 * Until now this was the constant string "Booked via online scheduling". Now it also says how
 * the appointment happens, and for a video visit carries a link the provider can click straight
 * from the schedule.
 *
 * WHICH LINK — the provider's, not the patient's. `notes` is a shared clinical field: staff read
 * it, copy it, and it is rendered into the day-sheet row tooltip
 * (appointmentprovideradminday.jsp ~line 2637), so anything here is visible to anyone who can
 * see the schedule. A patient's join token is a bearer credential to a live consultation and has
 * no business with that blast radius. The provider deep link is useless without a physician
 * session, and a staff member who follows it lands on the console where they can send the
 * patient their link properly.
 *
 * WIDTH — `appointment.notes` is varchar(255), verified on the live box 2026-08-01. OSCAR does
 * not complain about an over-long value, it truncates, and a truncated URL is worse than no URL,
 * so the prose is dropped before the link is ever cut.
 *
 * NO UPDATE PATH — the live WADL publishes only updateStatus, updateType and updateUrgency for
 * an existing appointment, so this is written once at creation and can never be amended. A room
 * created later (on-demand from the day sheet, or because Daily was down at booking time) will
 * not appear here. That is fine: the day-sheet button doesn't depend on the note, it works from
 * the appointment number alone.
 */

import type { AppointmentModality } from "@/lib/appointment-modality";

/** varchar(255) on the live box; a little headroom for OSCAR's own handling. */
export const MAX_NOTES_LEN = 250;

const MODALITY_NOTE_LABEL: Record<AppointmentModality, string> = {
  PHONE: "Phone visit",
  VIDEO: "Video visit",
  IN_PERSON: "In-person visit",
};

/**
 * Same sanitization as the `reason` field in the confirm route: strip control characters, strip
 * angle brackets, collapse whitespace. The day sheet renders these into HTML, and while OSCAR
 * escapes on output, the value also reaches printed daysheets and exports that may not.
 */
function sanitize(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildOscarAppointmentNotes(args: {
  modality: AppointmentModality;
  videoLaunchUrl?: string | null;
}): string {
  const parts = [MODALITY_NOTE_LABEL[args.modality], "booked online"];
  const prose = sanitize(parts.join(" — "));

  const url = args.videoLaunchUrl ? sanitize(args.videoLaunchUrl) : "";
  if (!url) return prose.slice(0, MAX_NOTES_LEN);

  // The link is the part with operational value, so it wins the budget. If the two together
  // don't fit, drop the prose rather than truncate a URL into something unclickable.
  const combined = `${prose} — ${url}`;
  if (combined.length <= MAX_NOTES_LEN) return combined;
  return url.slice(0, MAX_NOTES_LEN);
}

/**
 * The provider-side deep link that opens the video console.
 *
 * Keyed on our own appointment id rather than the OSCAR appointment number, because of the
 * ordering: the note is written as part of *creating* the OSCAR appointment, so its number does
 * not exist yet, and there is no update call to go back and add it afterwards. Our UUID is known
 * before the write.
 *
 * The id is not a credential — the console resolves it inside the caller's organization and
 * requires a physician session either way.
 */
export function buildVideoLaunchUrl(appUrl: string, appointmentId: string): string {
  return `${appUrl}/launch/oscar-video?appointmentId=${encodeURIComponent(appointmentId)}`;
}
