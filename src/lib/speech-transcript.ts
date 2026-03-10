const LEADING_TRANSCRIPT_PUNCTUATION_RE = /^[,.;:-]+\s*/;

export function stripLeadingTranscriptPunctuation(text: string) {
  let cleaned = text.trim();

  while (cleaned.length > 0) {
    const next = cleaned.replace(LEADING_TRANSCRIPT_PUNCTUATION_RE, "").trimStart();
    if (next === cleaned) {
      break;
    }
    cleaned = next;
  }

  return cleaned;
}

export function normalizePunctuation(text: string) {
  let t = stripLeadingTranscriptPunctuation(text);
  // Ensure space after sentence-ending punctuation (e.g. "cough.No" -> "cough. No")
  t = t.replace(/([.!?])([A-Z])/g, "$1 $2");
  // Add sentence breaks before capitalized pronouns if missing punctuation
  t = t.replace(/([a-z]) (I|He|She|They|We|You) /g, "$1. $2 ");
  t = stripLeadingTranscriptPunctuation(t);
  // Ensure ending punctuation
  if (t.length && !/[.!?]$/.test(t)) {
    t = t + ".";
  }
  return t;
}

export function lightCleanupTranscript(text: string) {
  let t = text.trim();
  t = t.replace(/\s+/g, " ");
  // Remove obvious filler tokens when isolated
  t = t.replace(/\b(um+|uh+|erm+|ah+)\b/gi, "");
  // Clean up punctuation artifacts left after filler removal
  t = t.replace(/,\s*,/g, ","); // ", ," -> ","
  t = t.replace(/\.\s*,\s*/g, ". "); // ". , " -> ". "
  t = t.replace(/,\s*\./g, "."); // ", ." -> "."
  t = t.replace(/\s+/g, " ").trim();
  t = stripLeadingTranscriptPunctuation(t);
  // Normalize common number words (1-10)
  const numberMap: Record<string, string> = {
    zero: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
  };
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (match) => {
    const key = match.toLowerCase();
    return numberMap[key] ?? match;
  });
  // Normalize common units
  t = t.replace(/\bmilligrams?\b/gi, "mg");
  t = t.replace(/\bmilliliters?\b/gi, "ml");
  t = t.replace(/\bmicrograms?\b/gi, "mcg");
  return t;
}
