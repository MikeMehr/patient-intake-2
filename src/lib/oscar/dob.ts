/**
 * Date-of-birth parsing for OSCAR demographic records.
 *
 * OSCAR's REST API does not return DOB in a single consistent shape. Observed /
 * documented representations include:
 *   - "1981-09-16"                         (plain ISO date)
 *   - "1981-09-16 00:00:00"                (Java Date toString-ish)
 *   - "1981-09-16T00:00:00.000-07:00"      (ISO datetime)
 *   - "1981/09/16"                         (slash separated)
 *   - epoch milliseconds (number or numeric string)
 *   - split components: yearOfBirth / monthOfBirth / dateOfBirth(=day-of-month)
 *     — OSCAR's DemographicTo1 model carries the day in a field named
 *       `dateOfBirth`, which is exactly what the create-patient write path sends.
 *
 * The previous lookup code accepted only the strict "^\d{4}-\d{2}-\d{2}$" form,
 * so any of the other shapes normalized to null and a real patient was reported
 * as "not found". These helpers tolerate all of the above while still returning
 * a strict YYYY-MM-DD (or null) so the caller's exact-match comparison is safe.
 */

function toIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function firstInt(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (v == null || v === "") continue;
    const n = Number(String(v).trim());
    if (Number.isInteger(n)) return n;
  }
  return null;
}

/**
 * Normalize a single DOB value to strict YYYY-MM-DD, or null if it isn't a
 * recognizable full date. A bare day-of-month (e.g. "16" or 16) returns null on
 * purpose, so callers fall back to reconstructing from split components.
 */
export function normalizeOscarDob(raw: unknown): string | null {
  if (raw == null) return null;

  // Epoch milliseconds — only treat sufficiently large magnitudes as epochs so a
  // small integer like a day-of-month (16) is never misread as 1970-01-01.
  const asEpoch =
    typeof raw === "number" && Math.abs(raw) >= 1e11
      ? raw
      : typeof raw === "string" && /^\d{12,}$/.test(raw.trim())
        ? Number(raw.trim())
        : null;
  if (asEpoch != null && Number.isFinite(asEpoch)) {
    const d = new Date(asEpoch);
    if (!Number.isNaN(d.getTime())) {
      // Use UTC components — DOB has no meaningful time/zone.
      return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }

  const s = String(raw).trim();
  if (!s) return null;

  // Leading YYYY-MM-DD or YYYY/MM/DD, optionally followed by a time/zone suffix.
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  return toIso(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Extract a normalized YYYY-MM-DD DOB from an OSCAR demographic object
 * (quickSearch item, summary, or full record). Tries combined full-date fields
 * first, then reconstructs from OSCAR's split year/month/day components.
 */
export function extractOscarDob(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;

  // 1) Combined full-date fields.
  for (const c of [
    obj.dob,
    obj.dateOfBirth,
    obj.birthDate,
    obj.birth_date,
    obj.dateOfBirthStr,
    obj.formattedDob,
    obj.dobStr,
  ]) {
    const norm = normalizeOscarDob(c);
    if (norm) return norm;
  }

  // 2) Split components. OSCAR stores the day-of-month in `dateOfBirth`.
  const year = firstInt(obj.yearOfBirth, obj.year_of_birth, obj.birthYear, obj.dobYear);
  const month = firstInt(obj.monthOfBirth, obj.month_of_birth, obj.birthMonth, obj.dobMonth);
  const day = firstInt(obj.dayOfBirth, obj.day_of_birth, obj.dateOfBirth, obj.birthDay, obj.dobDay);
  if (year != null && month != null && day != null) {
    return toIso(year, month, day);
  }

  return null;
}
