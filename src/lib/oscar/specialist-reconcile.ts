/**
 * Matches OSCAR's existing (already-added) specialists against bc_specialist_directory, so
 * specialists added to OSCAR years ago through the original manual migration show as "In OSCAR"
 * in the directory instead of "Not yet in OSCAR" — see the note in pathways-directory.ts's
 * OSCAR-sync section header. Pure matching logic only; the live OSCAR read is browser-driven
 * (mTLS gate, same constraint as everywhere else in this file's neighborhood).
 *
 * Deliberately conservative: a false "In OSCAR" match would point a physician's referral at the
 * WRONG specId (a same-named but different clinician), which is worse than just leaving a real
 * match unrecognized. Two independent signals are required, not one:
 *   1. Exact name-token-set match (order/asterisk/punctuation independent — OSCAR renders
 *      "LastName FirstName", sometimes with a leading "*" stored as literal data, e.g. the raw
 *      lastName field can literally be "*Jung"; PathwaysBC gives "FirstName LastName").
 *   2. At least one of the OSCAR specialist's actual service memberships (fetched live, not
 *      guessed) exactly matches the PathwaysBC specialization — same exact-match-only policy as
 *      matchOscarService in specialist-sync-plan.ts.
 * Zero or ambiguous (multiple) matches are left unlinked rather than guessed.
 */

export type OscarRosterEntry = {
  specId: string;
  /** Raw display text from ShowAllServices.do, e.g. "*Jung Gordon" (LastName FirstName order). */
  displayName: string;
  address: string | null;
  phone: string | null;
  fax: string | null;
  /** Every OSCAR service this specId is checked under, by name. */
  serviceNames: string[];
};

export type DirectoryCandidate = {
  bcSpecialistId: string;
  /** PathwaysBC's full display name, e.g. "Naveed Malek" (FirstName LastName order). */
  name: string;
  specialization: string;
};

export type ReconciliationMatch = {
  bcSpecialistId: string;
  oscarSpecId: string;
  oscarServiceName: string;
  address: string | null;
  phone: string | null;
  fax: string | null;
};

/** Order/asterisk/punctuation-independent token set for name comparison. */
export function normalizeNameTokens(raw: string): Set<string> {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return new Set(tokens);
}

function tokenSetKey(tokens: Set<string>): string {
  return Array.from(tokens).sort().join("|");
}

function tokenSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

/** Groups OSCAR roster entries by their exact name-token signature, for O(1) candidate lookup. */
export function buildOscarNameIndex(roster: OscarRosterEntry[]): Map<string, OscarRosterEntry[]> {
  const index = new Map<string, OscarRosterEntry[]>();
  for (const entry of roster) {
    const key = tokenSetKey(normalizeNameTokens(entry.displayName));
    const bucket = index.get(key);
    if (bucket) bucket.push(entry);
    else index.set(key, [entry]);
  }
  return index;
}

function specialtyOverlaps(candidateSpecialization: string, serviceNames: string[]): boolean {
  const target = candidateSpecialization.trim().toLowerCase();
  return serviceNames.some((s) => s.trim().toLowerCase() === target);
}

/**
 * For each PathwaysBC candidate, find its unique already-in-OSCAR match, if any. `roster` should
 * be the full live OSCAR specialist list (all specIds, with every service membership already
 * resolved) — building `nameIndex` once via buildOscarNameIndex and reusing it across many
 * candidates is the point of splitting these two functions.
 */
export function computeReconciliationMatches(
  candidates: DirectoryCandidate[],
  nameIndex: Map<string, OscarRosterEntry[]>,
): ReconciliationMatch[] {
  const matches: ReconciliationMatch[] = [];

  for (const candidate of candidates) {
    const key = tokenSetKey(normalizeNameTokens(candidate.name));
    const sameNameEntries = nameIndex.get(key) ?? [];
    // Re-verify with tokenSetsEqual (not just the key) in case of an extremely unlikely sort-key
    // collision, and require the specialty signal on top of the name signal.
    const candidateTokens = normalizeNameTokens(candidate.name);
    const confirmed = sameNameEntries.filter(
      (entry) =>
        tokenSetsEqual(candidateTokens, normalizeNameTokens(entry.displayName)) &&
        specialtyOverlaps(candidate.specialization, entry.serviceNames),
    );

    if (confirmed.length !== 1) continue; // zero or ambiguous — leave unlinked rather than guess

    const match = confirmed[0];
    matches.push({
      bcSpecialistId: candidate.bcSpecialistId,
      oscarSpecId: match.specId,
      oscarServiceName: match.serviceNames.find((s) => s.trim().toLowerCase() === candidate.specialization.trim().toLowerCase()) ?? match.serviceNames[0],
      address: match.address,
      phone: match.phone,
      fax: match.fax,
    });
  }

  return matches;
}
