/**
 * Pure planning logic for writing a queued BC specialist into OSCAR's consultation directory.
 *
 * No I/O here — OSCAR's mTLS device-cert gate means the actual writes can only run from an
 * already-authenticated browser session (see project memory: reference_oscar_device_cert_gate.md,
 * reference_oscar_specialist_migration.md), not a server-side job. This module is the reusable,
 * testable source of truth for the field mapping; the browser-driven runner mirrors it in plain
 * JS the same way scripts/pathways-sync.js mirrors src/lib/pathways/parse.ts.
 *
 * Field names below (firstName, lastName, proLetters, specType, referralNo, hideFromView, ...)
 * were confirmed 2026-08-11 against the live AddSpecialist.jsp form on oscar.mymdonline.ca —
 * they are OSCAR's own, not invented. So is the fact that phone and address are REQUIRED:
 * a submission with either blank is rejected with "Please enter Phone" / "Please enter Address"
 * (discovered live the same day, after two attempts with blank contact fields silently failed to
 * create anything). candidateHasRequiredContactInfo() is the gate on that — a candidate without
 * cached contact info from bc_specialist_contact_cache can't be synced yet, full stop.
 */

import type { OscarSyncCandidate } from "@/lib/pathways-directory";

/**
 * OSCAR silently no-ops AddSpecialist.do (200 OK, form re-render, no row inserted) unless
 * referralNo is blank or exactly 6 digits — confirmed empirically during the original A-Z
 * specialist migration. PathwaysBC's billingNumber is sometimes alphanumeric (e.g. "Q5759" for
 * some specialist categories), which doesn't fit that rule at all, so anything that isn't
 * cleanly 5 or 6 digits is left blank rather than mangled into a value that would silently fail.
 */
export function normalizeReferralNo(billingNumber: string | null): string {
  if (!billingNumber) return "";
  const digits = billingNumber.replace(/\D/g, "");
  if (digits.length === 6) return digits;
  if (digits.length === 5) return digits.padStart(6, "0");
  return "";
}

/**
 * PathwaysBC gives a full display name plus a separate last name; OSCAR wants them split.
 * Strips the known last name off the end of the full name rather than splitting on whitespace,
 * since some last names are themselves multi-word (e.g. "von Kleist").
 *
 * A trailing parenthetical is dropped first: PathwaysBC appends the practice to some names
 * ("Golmehr Sajjady (Aspire Bariatric & Lifestyle Clinic)"), which otherwise defeats the
 * suffix match and dumps the whole string into OSCAR's first-name field — seen live in OSCAR
 * record 1611 before this was fixed.
 */
export function deriveFirstName(fullName: string, lastName: string): string {
  const trimmedName = fullName.trim().replace(/\s*\([^)]*\)\s*$/, "").trim() || fullName.trim();
  const trimmedLast = lastName.trim();
  if (trimmedLast && trimmedName.toLowerCase().endsWith(trimmedLast.toLowerCase())) {
    const firstName = trimmedName.slice(0, trimmedName.length - trimmedLast.length).trim();
    if (firstName) return firstName;
  }
  return trimmedName;
}

const VALID_SALUTATIONS = new Set(["Dr.", "Mr.", "Mrs.", "Miss", "Ms."]);

/** OSCAR's salutation dropdown only accepts these exact values (else it's left "-Not Set-"). */
function normalizeSalutation(honorific: string | null): string {
  if (!honorific) return "";
  return VALID_SALUTATIONS.has(honorific) ? honorific : "";
}

/** Points a referring physician at the specialist's full PathwaysBC profile from inside OSCAR. */
export function buildAnnotation(pathwaysId: number): string {
  return `Added from PathwaysBC. Full office details: https://pathwaysbc.ca/specialists/${pathwaysId}`;
}

/**
 * OSCAR's hard requirement, confirmed live: AddSpecialist.do rejects a submission with no phone
 * or no address. Check this BEFORE attempting a write — don't rely on catching the rejection,
 * since a blank submission doesn't error, it just re-renders the form with no side effect.
 */
export function candidateHasRequiredContactInfo(candidate: OscarSyncCandidate): boolean {
  return Boolean(candidate.phone?.trim()) && Boolean(candidate.address?.trim());
}

/** The exact field set AddSpecialist.jsp submits — see the module comment for how this was confirmed. */
export type AddSpecialistPayload = {
  specId: "";
  firstName: string;
  lastName: string;
  proLetters: "";
  address: string;
  annotation: string;
  phone: string;
  fax: string;
  privatePhoneNumber: "";
  cellPhoneNumber: "";
  pagerNumber: "";
  salutation: string;
  website: "";
  email: string;
  specType: string;
  referralNo: string;
  institution: "0";
  department: "0";
  eDataUrl: "";
  eDataOscarKey: "";
  eDataServiceKey: "";
  eDataServiceName: "";
  hideFromView: "false";
  eformId: "0";
  /** Struts action-mapping dispatch fields — the form's submit button IS transType=name/value. */
  whichType: "1";
  transType: "Add Specialist";
};

/**
 * Callers MUST check candidateHasRequiredContactInfo() first — this does not check for you, so
 * the caller controls exactly how a missing-contact-info candidate is reported.
 */
export function buildAddSpecialistPayload(candidate: OscarSyncCandidate): AddSpecialistPayload {
  return {
    specId: "",
    firstName: deriveFirstName(candidate.name, candidate.lastName),
    lastName: candidate.lastName,
    proLetters: "",
    address: candidate.address ?? "",
    annotation: buildAnnotation(candidate.pathwaysId),
    phone: candidate.phone ?? "",
    fax: candidate.fax ?? "",
    privatePhoneNumber: "",
    cellPhoneNumber: "",
    pagerNumber: "",
    salutation: normalizeSalutation(candidate.honorific),
    website: "",
    email: candidate.email ?? "",
    specType: candidate.specialization,
    referralNo: normalizeReferralNo(candidate.billingNumber),
    institution: "0",
    department: "0",
    eDataUrl: "",
    eDataOscarKey: "",
    eDataServiceKey: "",
    eDataServiceName: "",
    hideFromView: "false",
    eformId: "0",
    whichType: "1",
    transType: "Add Specialist",
  };
}

export type OscarService = { id: string; name: string };

/**
 * Case-insensitive exact match only — no fuzzy matching. OSCAR already has near-duplicate
 * services from years of manual entry (e.g. "Neurology" and "Neuro." both exist); guessing wrong
 * would silently assign a specialist to the wrong consultation category. A specialty with no
 * exact match is reported as unmatched rather than assigned to a guess.
 */
export function matchOscarService(specialization: string, services: OscarService[]): OscarService | null {
  const target = specialization.trim().toLowerCase();
  return services.find((s) => s.name.trim().toLowerCase() === target) ?? null;
}
