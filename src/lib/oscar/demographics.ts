/**
 * Fetch and normalize a single OSCAR demographic record by demographic number.
 *
 * Extracted from src/app/api/emr/oscar/patient-details/route.ts so the OSCAR
 * launch flow can reuse it. The extraction also fixes a real defect: the route
 * derived DOB as
 *
 *   String(details.dob ?? details.dateOfBirth ?? details.birthDate ?? "")
 *
 * which is wrong for OSCAR builds that return split date components. OSCAR's
 * DemographicTo1 carries the *day of month* in a field named `dateOfBirth`, so
 * that expression yields "16" for a patient born 1981-09-16, and it also passes
 * "1981-09-16 00:00:00" and epoch milliseconds through unchanged. The shared
 * `extractOscarDob` helper handles every observed shape and always returns a
 * strict YYYY-MM-DD (or null).
 */

import { oscarSignedFetch } from "@/lib/oscar/client";
import type { OscarCreds } from "@/lib/oscar/self-serve";
import { extractOscarDob } from "@/lib/oscar/dob";
import { parseJsonValue } from "@/lib/safe-json";
import { canonicalizeEmail } from "@/lib/canonicalization";

export type OscarDemographic = {
  demographicNo: string;
  firstName: string | null;
  lastName: string | null;
  /** Strict YYYY-MM-DD, or null when OSCAR gave us nothing usable. */
  dateOfBirth: string | null;
  patientEmail: string | null;
  primaryPhone: string | null;
  secondaryPhone: string | null;
  insuranceNumber: string | null;
  /**
   * OSCAR's own `hc_type` — the 2-letter province the card was issued in, or null when the chart
   * carries none. Passed through untouched rather than defaulted: checkHealthCard() has its own
   * rule for a blank one, and applying it here would hide the difference.
   */
  healthCardType: string | null;
  patientAddress: string | null;
};

export type FetchDemographicResult =
  | { ok: true; demographic: OscarDemographic }
  | { ok: false; reason: "not_found" | "oscar_error" | "bad_response"; status: number; detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickFirstNonEmptyString(obj: any, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj?.[key];
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

export function normalizeAddressFromOscar(json: any): string | null {
  const top = json ?? {};
  const addrObj = isRecord(top.address) ? (top.address as any) : null;

  const street =
    pickFirstNonEmptyString(top, ["streetAddress", "address1", "address", "street", "line1", "line_1"]) ??
    (addrObj
      ? pickFirstNonEmptyString(addrObj, ["streetAddress", "address1", "address", "street", "line1", "line_1"])
      : null) ??
    // Some deployments split street number/name
    (() => {
      const num =
        pickFirstNonEmptyString(top, ["streetNumber", "street_no", "streetNum"]) ??
        (addrObj ? pickFirstNonEmptyString(addrObj, ["streetNumber", "street_no", "streetNum"]) : null);
      const name =
        pickFirstNonEmptyString(top, ["streetName", "street_name"]) ??
        (addrObj ? pickFirstNonEmptyString(addrObj, ["streetName", "street_name"]) : null);
      const combined = [num, name].filter(Boolean).join(" ").trim();
      return combined || null;
    })();

  const unit =
    pickFirstNonEmptyString(top, ["unit", "suite", "apt", "apartment"]) ??
    (addrObj ? pickFirstNonEmptyString(addrObj, ["unit", "suite", "apt", "apartment"]) : null);

  const city =
    pickFirstNonEmptyString(top, ["city", "municipality", "town"]) ??
    (addrObj ? pickFirstNonEmptyString(addrObj, ["city", "municipality", "town"]) : null);
  const province =
    pickFirstNonEmptyString(top, ["province", "state", "prov"]) ??
    (addrObj ? pickFirstNonEmptyString(addrObj, ["province", "state", "prov"]) : null);
  const postal =
    pickFirstNonEmptyString(top, ["postal", "postalCode", "zip"]) ??
    (addrObj ? pickFirstNonEmptyString(addrObj, ["postal", "postalCode", "zip"]) : null);

  const streetLine = [street, unit ? `Unit ${unit}` : null].filter(Boolean).join(", ").trim();
  const parts = [streetLine, city, province, postal].filter((p) => typeof p === "string" && p.trim().length > 0);
  return parts.length ? parts.join(", ") : null;
}

export function normalizeEmailFromOscar(json: any): string | null {
  const top = json ?? {};
  const contactObj = isRecord(top.contact) ? (top.contact as any) : null;
  const emailsObj = isRecord(top.emails) ? (top.emails as any) : null;

  // Try common OSCAR demographic field names (varies by deployment).
  const candidate =
    pickFirstNonEmptyString(top, ["email", "emailAddress", "email_address", "eMail", "patientEmail"]) ??
    (contactObj
      ? pickFirstNonEmptyString(contactObj, ["email", "emailAddress", "email_address", "eMail"])
      : null) ??
    (emailsObj
      ? pickFirstNonEmptyString(emailsObj, ["primary", "email", "emailAddress", "email_address"])
      : null);

  if (!candidate) return null;
  const normalized = canonicalizeEmail(candidate);
  // Very lightweight validation: avoid returning junk strings.
  if (!normalized.includes("@") || normalized.length > 254) return null;
  return normalized;
}

/** Normalize an already-parsed OSCAR demographic JSON object. */
export function normalizeOscarDemographic(demographicNo: string, details: any): OscarDemographic {
  const primaryPhone =
    String(details.phone ?? details.phoneNumber ?? details.primaryPhone ?? details.phone1 ?? "").trim() || null;
  const secondaryPhone =
    String(details.phone2 ?? details.secondaryPhone ?? details.alternatePhone ?? "").trim() || null;
  const insuranceNumber =
    String(details.hin ?? details.healthInsuranceNumber ?? details.insuranceNumber ?? details.hcNumber ?? "").trim() ||
    null;
  const healthCardType =
    String(details.hcType ?? details.hc_type ?? details.healthCardType ?? "").trim().toUpperCase() || null;

  const firstName = String(details.firstName ?? details.first_name ?? details.givenName ?? "").trim() || null;
  const lastName = String(details.lastName ?? details.last_name ?? details.surname ?? "").trim() || null;

  return {
    demographicNo,
    firstName,
    lastName,
    // Always via extractOscarDob — see the file header for why the naive
    // field-coalesce this replaced was wrong.
    dateOfBirth: extractOscarDob(details),
    patientEmail: normalizeEmailFromOscar(details),
    primaryPhone,
    secondaryPhone,
    insuranceNumber,
    healthCardType,
    patientAddress: normalizeAddressFromOscar(details),
  };
}

/** GET {restBase}/demographics/{demographicNo}, OAuth1-signed, normalized. */
export async function fetchOscarDemographic(
  creds: OscarCreds,
  demographicNo: string,
): Promise<FetchDemographicResult> {
  let oscarRes: Response;
  try {
    oscarRes = await oscarSignedFetch({
      method: "GET",
      url: `${creds.restBase}/demographics/${encodeURIComponent(demographicNo)}`,
      clientKey: creds.client_key,
      clientSecret: creds.clientSecret,
      accessToken: creds.accessToken,
      tokenSecret: creds.tokenSecret,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "oscar_error",
      status: 503,
      detail: err instanceof Error ? err.message : "Network error reaching OSCAR",
    };
  }

  const rawText = await oscarRes.text();
  if (!oscarRes.ok) {
    return {
      ok: false,
      reason: oscarRes.status === 404 ? "not_found" : "oscar_error",
      status: oscarRes.status,
      detail: rawText.slice(0, 500),
    };
  }

  let json: unknown = null;
  try {
    json = parseJsonValue(rawText, "OSCAR patient details response");
  } catch {
    return { ok: false, reason: "bad_response", status: 502, detail: rawText.slice(0, 500) };
  }
  if (!isRecord(json)) {
    return { ok: false, reason: "bad_response", status: 502, detail: rawText.slice(0, 500) };
  }

  return { ok: true, demographic: normalizeOscarDemographic(demographicNo, json) };
}
