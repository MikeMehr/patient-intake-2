/**
 * Extracts office contact info from a PathwaysBC specialist profile page (pathwaysbc.ca/specialists/:id).
 *
 * This info is NOT in the global data export (confirmed 2026-08-11 — see parse.ts's header),
 * only server-rendered on each specialist's own profile page, in an "Office Information" section
 * with no clean semantic markup (no labelled fields, just a run of text lines). So this parses
 * the page's rendered line-by-line text (`element.innerText.split('\n')`, not raw HTML) between
 * the "Office Information" and "Referral Information and Requirements" headings.
 *
 * Deliberately conservative: any field it isn't confident about is left null rather than guessed
 * — a wrong phone/address on a specialist's OSCAR record is worse than a missing one, especially
 * since OSCAR requires phone+address to create the record at all (see specialist-sync-plan.ts),
 * so a null here just means that specialist waits for the next backfill attempt.
 */

export type SpecialistContactInfo = {
  phone: string | null;
  fax: string | null;
  email: string | null;
  clinicAddress: string | null;
  acceptedBy: string | null;
  respondedBy: string | null;
};

const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}\b/;
const FAX_LINE_RE = /^Fax:\s*(.+)$/i;
/** PathwaysBC labels these several ways ("Public email (okay for patient use):", "Private email
 *  (for physician office use only):"), so match on the word rather than one exact prefix. */
const EMAIL_LINE_RE = /^[^:]*\bemail\b[^:]*:\s*(.+)$/i;
const EMAIL_ADDR_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const ACCEPTED_BY_RE = /^Accepted by:\s*(.+)$/i;
const RESPONDED_BY_RE = /^Responded to by:\s*(.+)$/i;
// Lines that appear in the office block but aren't a phone/fax/email/address — skip, don't
// mistake one for the address. The labelled ones (Website/Hours/Parking/…) and anything holding
// a URL are all things that were, or would be, written into OSCAR's address field verbatim:
// "Website: https://cranbrookpeds.ca/" landed in OSCAR record 1623's address before this.
const FILLER_LINE_RE =
  /^(phone lines?|website\b|hours\b|parking\b|wheelchair|this practice|.*is spoken by the consultant\.?$|.*language.*spoken.*)/i;
const URL_RE = /\bhttps?:\/\/|\bwww\./i;

function stripTrailingOthersSuffix(line: string): string {
  return line.replace(/\s+with\s+\d+\s+others?\.?$/i, "").trim();
}

/** Canadian postal code — the one high-confidence signal that a line is a street address. */
const POSTAL_CODE_RE = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i;
/** A line that is nothing but a phone number, i.e. how PathwaysBC renders a clinic's number. */
const BARE_PHONE_LINE_RE = /^\(?\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}$/;

/**
 * Fallback for specialists with no "Office Information" heading at all — those who work only out
 * of hospitals or health-authority programs, where PathwaysBC renders the contact details under a
 * clinic/program block instead (confirmed live 2026-08-11 on specialist 5230, a hospital-based
 * stroke clinic).
 *
 * Anchors on a postal code rather than trying to recognize an address generally: it's a specific,
 * low-false-positive signal, which matters because a wrong address on a referral is worse than a
 * missing one. Everything else is located relative to that line.
 */
function parseClinicBlockFallback(lines: string[]): { phone: string | null; fax: string | null; clinicAddress: string | null } {
  const addressIdx = lines.findIndex((l) => POSTAL_CODE_RE.test(l));
  if (addressIdx === -1) return { phone: null, fax: null, clinicAddress: null };

  let clinicAddress = lines[addressIdx];
  // PathwaysBC puts the venue on its own line above the street address ("In Royal Columbian
  // Hospital"). Keep it — it's the part a referring physician actually recognizes.
  const venue = lines[addressIdx - 1];
  if (venue && venue.length <= 80 && !POSTAL_CODE_RE.test(venue) && !BARE_PHONE_LINE_RE.test(venue) && !FAX_LINE_RE.test(venue)) {
    clinicAddress = `${venue}, ${clinicAddress}`;
  }

  // Phone/fax render just above the address; scan back a short window so a number belonging to a
  // different clinic further up the page can't be picked up.
  let phone: string | null = null;
  let fax: string | null = null;
  for (let i = addressIdx - 1; i >= 0 && i >= addressIdx - 6; i--) {
    const line = lines[i];
    const faxMatch = line.match(FAX_LINE_RE);
    if (!fax && faxMatch) {
      fax = faxMatch[1].trim();
      continue;
    }
    if (!phone && BARE_PHONE_LINE_RE.test(line)) phone = line;
  }

  return { phone, fax, clinicAddress: stripTrailingOthersSuffix(clinicAddress) };
}

export function parseSpecialistProfileText(pageText: string): SpecialistContactInfo {
  const lines = pageText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const officeStart = lines.findIndex((l) => l === "Office Information");
  const officeEndCandidates = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) => i > officeStart && /^Referral Information/i.test(l));
  const officeEnd = officeEndCandidates.length > 0 ? officeEndCandidates[0].i : lines.length;
  const officeBlock = officeStart === -1 ? [] : lines.slice(officeStart + 1, officeEnd);

  let phone: string | null = null;
  let fax: string | null = null;
  let email: string | null = null;
  let clinicAddress: string | null = null;

  for (const line of officeBlock) {
    // First match wins, same as phone/clinicAddress below — a specialist with several offices
    // listed would otherwise pair the FIRST office's phone/address with the LAST office's fax/
    // email. Seen live 2026-08-17 during the bulk PathwaysBC import: Dr. Bahar Bahrani's profile
    // lists two clinics, and an unguarded overwrite here paired Sina Medical's phone/address with
    // Lonsdale Square's fax — a wrong number for a referral to reach the right office by.
    const faxMatch = line.match(FAX_LINE_RE);
    if (!fax && faxMatch) {
      fax = faxMatch[1].trim();
      continue;
    }

    const emailLineMatch = line.match(EMAIL_LINE_RE);
    if (!email && emailLineMatch) {
      const addr = emailLineMatch[1].match(EMAIL_ADDR_RE);
      email = addr ? addr[0] : emailLineMatch[1].trim();
      continue;
    }

    if (!phone && PHONE_RE.test(line)) {
      const m = line.match(PHONE_RE);
      phone = m ? m[0] : null;
      continue;
    }

    if (FILLER_LINE_RE.test(line)) continue;
    // Belt and braces: an email line must never become the address, however it's labelled.
    // Seen live — "Private email (for physician office use only): …" was written into OSCAR
    // record 1620's address field.
    if (EMAIL_ADDR_RE.test(line)) continue;

    if (!clinicAddress) {
      clinicAddress = stripTrailingOthersSuffix(line);
    }
  }

  // No "Office Information" section, or one that didn't yield the two fields OSCAR requires —
  // try the hospital/clinic-block layout before giving up.
  if (!phone || !clinicAddress) {
    const fallback = parseClinicBlockFallback(lines);
    phone = phone ?? fallback.phone;
    fax = fax ?? fallback.fax;
    clinicAddress = clinicAddress ?? fallback.clinicAddress;
  }

  // acceptedBy/respondedBy sit just after the office block but are scanned over the whole page
  // text rather than officeBlock alone, since their exact position relative to "Referral
  // Information and Requirements" isn't guaranteed the same way office-block fields are.
  let acceptedBy: string | null = null;
  let respondedBy: string | null = null;
  for (const line of lines) {
    if (!acceptedBy) {
      const m = line.match(ACCEPTED_BY_RE);
      if (m) acceptedBy = m[1].replace(/\.$/, "").trim();
    }
    if (!respondedBy) {
      const m = line.match(RESPONDED_BY_RE);
      if (m) respondedBy = m[1].replace(/\.$/, "").trim();
    }
  }

  return { phone, fax, email, clinicAddress, acceptedBy, respondedBy };
}
