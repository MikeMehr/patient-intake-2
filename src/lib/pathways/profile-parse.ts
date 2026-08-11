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
const EMAIL_LINE_RE = /^Public email[^:]*:\s*(.+)$/i;
const EMAIL_ADDR_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const ACCEPTED_BY_RE = /^Accepted by:\s*(.+)$/i;
const RESPONDED_BY_RE = /^Responded to by:\s*(.+)$/i;
// Lines that appear in the office block but aren't a phone/fax/email/address — skip, don't
// mistake one for the address.
const FILLER_LINE_RE = /^(phone lines?|.*is spoken by the consultant\.?$|.*language.*spoken.*)/i;

function stripTrailingOthersSuffix(line: string): string {
  return line.replace(/\s+with\s+\d+\s+others?\.?$/i, "").trim();
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
    const faxMatch = line.match(FAX_LINE_RE);
    if (faxMatch) {
      fax = faxMatch[1].trim();
      continue;
    }

    const emailLineMatch = line.match(EMAIL_LINE_RE);
    if (emailLineMatch) {
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

    if (!clinicAddress) {
      clinicAddress = stripTrailingOthersSuffix(line);
    }
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
