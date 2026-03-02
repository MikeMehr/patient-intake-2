export function canonicalizeUnicode(value: string): string {
  return String(value ?? "").normalize("NFKC").trim();
}

export function canonicalizeIdentifier(value: string): string {
  return canonicalizeUnicode(value).replace(/\s+/g, "");
}

export function canonicalizeEmail(value: string): string {
  return canonicalizeUnicode(value).toLowerCase();
}

export function canonicalizeForLookup(value: string): string {
  return canonicalizeUnicode(value)
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
