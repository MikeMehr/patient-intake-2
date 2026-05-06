function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces occurrences of a patient's name in extracted PDF text with [REDACTED].
 * Matches: "First Last", "Last, First", "Last,First" — all case-insensitive.
 * Individual first/last names are intentionally NOT redacted to avoid false
 * positives with physician names.
 */
export function redactPatientName(text: string, fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return text;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return text;

  const firstName = parts[0];
  const lastName = parts[parts.length - 1];

  const patterns: RegExp[] = [
    new RegExp(escapeRegex(trimmed), "gi"),
  ];

  if (parts.length >= 2) {
    patterns.push(new RegExp(escapeRegex(`${lastName}, ${firstName}`), "gi"));
    patterns.push(new RegExp(escapeRegex(`${lastName},${firstName}`), "gi"));
  }

  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}
