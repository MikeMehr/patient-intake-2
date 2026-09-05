/**
 * Pure helpers for the three-field date-of-birth input (DateOfBirthField).
 *
 * The component emits the same "YYYY-MM-DD" string a native <input type="date">
 * produces, so the booking/interview API contracts are unchanged. These live
 * here (not in the component) so they run under the node vitest environment.
 */

export const DOB_MIN_YEAR = 1900;

export const MONTHS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
] as const;

const MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Days in a month. With no year yet, February allows 29 — re-checked once typed. */
export function daysInMonth(month: number, year?: number): number {
  if (month < 1 || month > 12) return 31;
  if (!year) return MAX_DAYS[month - 1]!;
  return new Date(year, month, 0).getDate();
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Compose "YYYY-MM-DD" from the three parts, or "" unless they form a real
 * date between DOB_MIN_YEAR and today. Single-digit day input is padded.
 */
export function composeDob(month: string, day: string, year: string): string {
  if (!month || !day || year.length !== 4) return "";
  if (!/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day) || !/^\d{4}$/.test(year)) return "";
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  const y = parseInt(year, 10);
  if (y < DOB_MIN_YEAR || y > new Date().getFullYear()) return "";
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(m, y)) return "";
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return iso > todayIso() ? "" : iso;
}

/** Split "YYYY-MM-DD" back into parts; all empty for anything else. */
export function parseDob(value: string): { month: string; day: string; year: string } {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { month: "", day: "", year: "" };
  return { year: m[1]!, month: m[2]!, day: m[3]! };
}

/**
 * Human explanation of why fully-entered parts don't make a valid birth date.
 * Null while any part is still incomplete — never nag mid-entry.
 */
export function dobProblem(month: string, day: string, year: string): string | null {
  if (!month || !day || year.length !== 4) return null;
  if (composeDob(month, day, year)) return null;
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  const y = parseInt(year, 10);
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(y) || y < DOB_MIN_YEAR || y > currentYear) {
    return `Please enter a year between ${DOB_MIN_YEAR} and ${currentYear}.`;
  }
  const monthName = MONTHS[m - 1]?.label;
  if (monthName && (!Number.isInteger(d) || d < 1 || d > daysInMonth(m, y))) {
    return `${monthName} ${y} has only ${daysInMonth(m, y)} days — please check the day.`;
  }
  return "This date is in the future — please check the year.";
}
