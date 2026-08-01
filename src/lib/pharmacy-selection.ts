/**
 * The pharmacy a patient picks during online booking.
 *
 * Shared by the picker component, the booking confirm route and their tests so the wire shape is
 * defined in exactly one place.
 *
 * DIRECTORY carries only an id: the server re-reads name/address/fax from pharmacy_directory by
 * that id and ignores everything else the client sent. FREE_TEXT is what the patient typed when
 * their pharmacy isn't in the clinic's OSCAR directory — it is stored on the booking and flagged
 * for staff, never written into OSCAR's shared pharmacy table.
 */

export type PharmacySelection =
  | {
      source: "DIRECTORY";
      pharmacyId: string;
      name: string;
      address?: string;
      city?: string;
      phone?: string;
      fax?: string;
    }
  | {
      source: "FREE_TEXT";
      name: string;
      address?: string;
      city?: string;
      phone?: string;
      fax?: string;
    };

// Mirrors the caps on the six pharmacy* fields in @/lib/interview-schema, so the two pharmacy
// representations in this codebase stay dimensionally compatible.
const MAX_NAME = 200;
const MAX_ADDRESS = 300;
const MAX_CITY = 120;
const MAX_PHONE = 50;
const MAX_FAX = 50;

const PHARMACY_ID_RE = /^\d{1,10}$/;

/**
 * Same treatment the booking `reason` field gets: this text is rendered into OSCAR's HTML, and
 * escaping there is the real defence, but anonymous public input shouldn't carry control
 * characters or angle brackets in the first place.
 */
function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function optional(value: unknown, max: number): string | undefined {
  const cleaned = clean(value, max);
  return cleaned || undefined;
}

/**
 * Validate and normalize what the booking form posted. Returns null when there is no usable
 * selection — an absent pharmacy is the normal case, not an error.
 */
export function normalizePharmacySelection(raw: unknown): PharmacySelection | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;

  const name = clean(input.name, MAX_NAME);
  if (!name) return null;

  const common = {
    name,
    address: optional(input.address, MAX_ADDRESS),
    city: optional(input.city, MAX_CITY),
    phone: optional(input.phone, MAX_PHONE),
    fax: optional(input.fax, MAX_FAX),
  };

  if (input.source === "DIRECTORY") {
    const pharmacyId = String(input.pharmacyId ?? "").trim();
    // An unusable id would silently become a free-text entry with a directory label, so reject it.
    if (!PHARMACY_ID_RE.test(pharmacyId)) return null;
    return { source: "DIRECTORY", pharmacyId, ...common };
  }

  if (input.source === "FREE_TEXT") {
    return { source: "FREE_TEXT", ...common };
  }

  return null;
}
