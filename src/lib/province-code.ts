/**
 * Canadian province/territory name → 2-letter code.
 *
 * The booking form posts full names ("British Columbia"), while everything downstream — OSCAR's
 * `demographic.hcType`, the health-card checks in lib/billing — speaks 2-letter codes. This is the
 * one place that translation lives, so the two callers cannot drift apart.
 *
 * Deliberately dependency-free: the billing helpers that use it must stay pure and testable without
 * pulling in the database or an OSCAR client.
 */

const PROVINCE_CODES: Record<string, string> = {
  "ALBERTA": "AB", "AB": "AB",
  "BRITISH COLUMBIA": "BC", "BC": "BC",
  "MANITOBA": "MB", "MB": "MB",
  "NEW BRUNSWICK": "NB", "NB": "NB",
  "NEWFOUNDLAND AND LABRADOR": "NL", "NEWFOUNDLAND": "NL", "NL": "NL",
  "NORTHWEST TERRITORIES": "NT", "NT": "NT",
  "NOVA SCOTIA": "NS", "NS": "NS",
  "NUNAVUT": "NU", "NU": "NU",
  "ONTARIO": "ON", "ON": "ON",
  "PRINCE EDWARD ISLAND": "PE", "PE": "PE", "PEI": "PE",
  "QUEBEC": "QC", "QC": "QC",
  "SASKATCHEWAN": "SK", "SK": "SK",
  "YUKON": "YT", "YT": "YT",
};

/**
 * Map a Canadian province/territory name (or code) to its 2-letter code, which is also OSCAR's
 * health-card type. Returns "" for anything unrecognized — callers treat that as "not stated"
 * rather than guessing a province.
 */
export function toProvinceCode(province: string | null | undefined): string {
  return PROVINCE_CODES[(province || "").trim().toUpperCase()] ?? "";
}
