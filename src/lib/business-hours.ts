/**
 * Clinic booking window for appointment slots.
 *
 * Appointments run 8:00 AM – 7:00 PM local clinic time, so the latest slot a
 * doctor can start is 6:45 PM. Enforced on both the Add Slot form and the
 * POST /api/org/slots route, mainly to catch the easy AM/PM slip (entering
 * 8:00 PM when 8:00 AM was meant).
 */

export const DAY_START_MINUTES = 8 * 60; // 8:00 AM — earliest start
export const LAST_START_MINUTES = 18 * 60 + 45; // 6:45 PM — latest start
export const DAY_END_MINUTES = 19 * 60; // 7:00 PM — latest end

/** Minutes-since-midnight rendered as "8:00 AM" / "6:45 PM". */
export function formatMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(2, "0");
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${ampm}`;
}

/** Local calendar date + minutes-since-midnight for an instant in a timezone. */
export function partsInZone(
  d: Date,
  timeZone: string,
): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10),
  };
}

/** Same shape as partsInZone, for a local "YYYY-MM-DDTHH:mm" string. */
export function partsFromLocalString(
  value: string,
): { date: string; minutes: number } | null {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return {
    date: m[1]!,
    minutes: parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10),
  };
}

/**
 * Returns an error message when the range falls outside the booking window,
 * or null when it's fine. Messages echo the entered time so an AM/PM mix-up is
 * obvious at a glance.
 */
export function checkBusinessHours(
  start: { date: string; minutes: number },
  end: { date: string; minutes: number },
): string | null {
  if (start.date !== end.date) {
    return "An appointment must start and end on the same day.";
  }
  if (start.minutes < DAY_START_MINUTES) {
    return `Appointments can't start before ${formatMinutes(DAY_START_MINUTES)} — you entered ${formatMinutes(start.minutes)}. Check AM/PM.`;
  }
  if (start.minutes > LAST_START_MINUTES) {
    return `The latest an appointment can start is ${formatMinutes(LAST_START_MINUTES)} — you entered ${formatMinutes(start.minutes)}. Check AM/PM.`;
  }
  if (end.minutes > DAY_END_MINUTES) {
    return `Appointments must end by ${formatMinutes(DAY_END_MINUTES)} — you entered ${formatMinutes(end.minutes)}. Check AM/PM.`;
  }
  return null;
}

/** Human-readable window, for form hint text and API errors. */
export const BUSINESS_HOURS_LABEL = `${formatMinutes(DAY_START_MINUTES)}–${formatMinutes(DAY_END_MINUTES)} (last start ${formatMinutes(LAST_START_MINUTES)})`;
