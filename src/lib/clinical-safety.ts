export const CLINICAL_ASSISTIVE_DISCLAIMER =
  "AI-generated clinical documentation and care suggestions are assistive tools only and require independent physician verification prior to clinical use.";

export const PHYSICIAN_ATTESTATION_TEXT =
  "I confirm that I have reviewed and validated the above documentation and orders and accept responsibility for clinical decisions.";

const PROHIBITED_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\bmost likely diagnosis is\b/gi,
    replacement: "Clinical features suggest",
  },
  {
    pattern: /\bthe diagnosis is\b/gi,
    replacement: "Differential considerations include",
  },
  {
    pattern: /\bpatient has\b/gi,
    replacement: "Findings may be consistent with",
  },
  {
    pattern: /\bstart treatment with\b/gi,
    replacement: "Consider treatment options such as",
  },
  {
    pattern: /\bbegin treatment with\b/gi,
    replacement: "Consider treatment options such as",
  },
  {
    pattern: /\bmust start\b/gi,
    replacement: "consider starting",
  },
];

export function sanitizeAssistiveClinicalText(input: string): {
  text: string;
  changed: boolean;
} {
  let next = input;
  let changed = false;
  PROHIBITED_PATTERNS.forEach(({ pattern, replacement }) => {
    const replaced = next.replace(pattern, replacement);
    if (replaced !== next) {
      changed = true;
      next = replaced;
    }
  });
  return { text: next, changed };
}

