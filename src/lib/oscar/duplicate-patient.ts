/**
 * Duplicate-chart guard for self-serve OSCAR patient creation.
 *
 * Online booking finds an existing patient by name + date of birth. A patient who
 * mistypes their date of birth therefore looks brand new, and the flow happily
 * creates a second chart for someone the clinic already has — same person, same
 * health card, two demographics, and from then on two halves of one medical record.
 *
 * A health card number identifies a person on its own, so a name + card match is
 * conclusive enough to refuse the second chart even though the date of birth
 * disagrees. The disagreement is the whole signal: either the patient typed their
 * birthday wrong, or the chart has it wrong, and both need a human.
 *
 * Matching notes:
 *  - Card comparison ignores spaces, dashes and case — the same PHN typed three
 *    ways is one card.
 *  - Surname must match. Given name is compared leniently (prefix, so Chris/Christopher
 *    match) because with the surname and the card already agreeing, a nickname is a
 *    far more likely explanation than two different people.
 */

export type DuplicateCandidate = {
  demographicNo: string;
  firstName?: string | null;
  lastName?: string | null;
  /** The chart's health card number, as OSCAR stores it (`demographic.hin`). */
  healthCardNumber?: string | null;
};

export type DuplicateSubject = {
  firstName: string;
  lastName: string;
  healthCardNumber: string;
};

/**
 * What the patient is told when their new chart is refused. Says which field to
 * re-check, and points at a human for the case where the field was right all along —
 * only the clinic can reconcile a chart whose date of birth is wrong. The clinic's
 * address is carried alongside as its own field, the way the booking flow's other
 * blocked states do it, so the UI can render it as a mailto link.
 */
export function duplicateChartMessage(): string {
  return (
    "This clinic already has a patient record with this name and health card number, " +
    "but the date of birth doesn't match it. Please check the date of birth you entered. " +
    "If it is correct, contact the clinic so they can update your record."
  );
}

/** Letters and digits only, uppercased — "9012 345-678" and "9012345678" are one card. */
export function normalizeHealthCard(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Fold a name for comparison: accents stripped, letters only, lowercased. Only the
 * first token is kept, so a middle name recorded in the given-name field ("Ann Marie"
 * vs "Ann") doesn't defeat the match.
 */
export function normalizeNameForMatch(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .split(/[\s,]+/)[0]!
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** Surname must be identical; given name may be a shortening of the other. */
function namesMatch(candidate: DuplicateCandidate, subject: DuplicateSubject): boolean {
  const candLast = normalizeNameForMatch(candidate.lastName);
  const subjLast = normalizeNameForMatch(subject.lastName);
  if (!candLast || !subjLast || candLast !== subjLast) return false;

  const candFirst = normalizeNameForMatch(candidate.firstName);
  const subjFirst = normalizeNameForMatch(subject.firstName);
  if (!candFirst || !subjFirst) return false;
  if (candFirst === subjFirst) return true;

  const [shorter, longer] =
    candFirst.length <= subjFirst.length ? [candFirst, subjFirst] : [subjFirst, candFirst];
  return shorter.length >= 2 && longer.startsWith(shorter);
}

/**
 * The first chart that is the same person as `subject`, or null when none is.
 * A subject with no health card number never matches: without a card there is
 * nothing here that name + date of birth didn't already rule out.
 */
export function findDuplicateChart(
  candidates: DuplicateCandidate[],
  subject: DuplicateSubject,
): DuplicateCandidate | null {
  const subjectCard = normalizeHealthCard(subject.healthCardNumber);
  // A card too short to be a real one (or OSCAR's 0000000000 placeholder, which is
  // on many charts at once) would match half the clinic.
  if (subjectCard.length < 6 || /^0+$/.test(subjectCard)) return null;

  for (const candidate of candidates) {
    if (!candidate.demographicNo) continue;
    if (normalizeHealthCard(candidate.healthCardNumber) !== subjectCard) continue;
    if (!namesMatch(candidate, subject)) continue;
    return candidate;
  }
  return null;
}
