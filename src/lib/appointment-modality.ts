/**
 * How an appointment actually happens — phone, video, or at the clinic.
 *
 * Configured per clinic in booking settings (`booking_settings.appointment_modality`)
 * and shown at every patient touchpoint of the booking flow so nobody turns up at
 * a door for a call, or waits by the phone for an in-person visit.
 */

export type AppointmentModality = "PHONE" | "VIDEO" | "IN_PERSON";

export const APPOINTMENT_MODALITIES: AppointmentModality[] = ["PHONE", "VIDEO", "IN_PERSON"];

export const DEFAULT_APPOINTMENT_MODALITY: AppointmentModality = "PHONE";

/** Short label, e.g. shown beside the date on confirmation screens. */
export const MODALITY_LABEL: Record<AppointmentModality, string> = {
  PHONE:     "Phone appointment",
  VIDEO:     "Video appointment",
  IN_PERSON: "In-person appointment",
};

/** Shown beside the label so the format reads at a glance. */
export const MODALITY_ICON: Record<AppointmentModality, string> = {
  PHONE:     "📞",
  VIDEO:     "🎥",
  IN_PERSON: "🏥",
};

/** Tells the patient what will actually happen at the appointment time. */
export const MODALITY_NOTE: Record<AppointmentModality, string> = {
  PHONE:
    "The physician will call you at the phone number on your file at the scheduled time. Please be available to answer.",
  VIDEO:
    "A link to join the video call will be sent to you before the scheduled time.",
  IN_PERSON:
    "Please come to the clinic a few minutes before the scheduled time.",
};

export function normalizeModality(value: unknown): AppointmentModality {
  return APPOINTMENT_MODALITIES.includes(value as AppointmentModality)
    ? (value as AppointmentModality)
    : DEFAULT_APPOINTMENT_MODALITY;
}
