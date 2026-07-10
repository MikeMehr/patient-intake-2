/**
 * Business-hours gate for the self-serve AI Guided Interview.
 *
 * Patients may only start a guided interview between 8:00am and 7:00pm Pacific
 * time (the clinic's local timezone). This is enforced authoritatively on the
 * server (interview-intake/start) and mirrored on the client for a friendly
 * "closed" screen. Computing the hour in a fixed timezone keeps the gate
 * consistent regardless of the patient device's clock/timezone.
 */

export const INTERVIEW_OPEN_HOUR = 8; // 8:00am, inclusive
export const INTERVIEW_CLOSE_HOUR = 19; // 7:00pm, exclusive
export const INTERVIEW_TIMEZONE = "America/Vancouver";

/** Current hour (0–23) in the clinic's timezone. */
function currentHourInTimezone(timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  // Intl can emit "24" for midnight under hour12:false — normalize to 0.
  return hour === 24 ? 0 : hour;
}

/** Whether the guided interview is currently within business hours. */
export function isWithinInterviewHours(timeZone: string = INTERVIEW_TIMEZONE): boolean {
  const hour = currentHourInTimezone(timeZone);
  return hour >= INTERVIEW_OPEN_HOUR && hour < INTERVIEW_CLOSE_HOUR;
}
