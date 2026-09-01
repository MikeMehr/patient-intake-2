import { getClient, query } from "@/lib/db";

export const STYLE_RULE_NOTE_TYPES = ["soap", "recommendations_imaging", "recommendations_referrals"] as const;
export type StyleRuleNoteType = (typeof STYLE_RULE_NOTE_TYPES)[number];

export const MAX_RULES_PER_TYPE = 20;
export const MAX_RULE_LENGTH = 200;

export type StyleRule = {
  id: string;
  noteType: StyleRuleNoteType;
  ruleText: string;
  createdAt: string;
};

type StyleRuleRow = {
  id: string;
  note_type: StyleRuleNoteType;
  rule_text: string;
  created_at: string;
};

function rowToRule(row: StyleRuleRow): StyleRule {
  return { id: row.id, noteType: row.note_type, ruleText: row.rule_text, createdAt: row.created_at };
}

export async function listStyleRules(physicianId: string, noteType?: StyleRuleNoteType): Promise<StyleRule[]> {
  const params: any[] = [physicianId];
  let sql = `SELECT id, note_type, rule_text, created_at
             FROM physician_ai_style_rules
             WHERE physician_id = $1`;
  if (noteType) {
    params.push(noteType);
    sql += ` AND note_type = $2`;
  }
  sql += ` ORDER BY note_type, sort_order, created_at`;
  const res = await query<StyleRuleRow>(sql, params);
  return res.rows.map(rowToRule);
}

// Style rules are an enhancement: a rules-table failure must never break note
// generation, so this swallows DB errors and returns an empty list.
export async function listStyleRuleTexts(physicianId: string, noteType: StyleRuleNoteType): Promise<string[]> {
  try {
    const rules = await listStyleRules(physicianId, noteType);
    return rules.map((r) => r.ruleText);
  } catch (error) {
    console.error("[ai-style-rules] failed to load style rules:", error);
    return [];
  }
}

export async function replaceStyleRules(
  physicianId: string,
  noteType: StyleRuleNoteType,
  rules: string[],
): Promise<StyleRule[]> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM physician_ai_style_rules WHERE physician_id = $1 AND note_type = $2`,
      [physicianId, noteType],
    );
    const saved: StyleRule[] = [];
    for (let i = 0; i < rules.length; i++) {
      const inserted = await client.query<StyleRuleRow>(
        `INSERT INTO physician_ai_style_rules (physician_id, note_type, rule_text, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING id, note_type, rule_text, created_at`,
        [physicianId, noteType, rules[i], i],
      );
      saved.push(rowToRule(inserted.rows[0]));
    }
    await client.query("COMMIT");
    return saved;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteStyleRule(physicianId: string, ruleId: string): Promise<boolean> {
  const res = await query(
    `DELETE FROM physician_ai_style_rules WHERE id = $1 AND physician_id = $2`,
    [ruleId, physicianId],
  );
  return (res.rowCount ?? 0) > 0;
}

// Heuristic backstop against patient-specific content slipping into stored rules.
// The distillation prompt is the primary defense; these patterns catch obvious leaks.
const PHI_RULE_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/, // ISO date
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, // slash date
  /\d{6,}/, // long digit run (PHN, MRN)
  /\b\d{3}[- ]\d{3}[- ]?\d{4}\b/, // phone
  /\bthis patient\b/i,
  /\b(mr|mrs|ms|dob)\b\.?\s/i,
];

export function sanitizeRules(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rules) {
    if (typeof raw !== "string") continue;
    const rule = raw.trim().replace(/\s+/g, " ");
    if (!rule || rule.length > MAX_RULE_LENGTH) continue;
    if (PHI_RULE_PATTERNS.some((p) => p.test(rule))) continue;
    const key = rule.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
    if (out.length >= MAX_RULES_PER_TYPE) break;
  }
  return out;
}

export function formatStyleRulesAppendix(rules: string[], scopeLabel: string): string {
  if (!rules.length) return "";
  return [
    `PHYSICIAN STYLE PREFERENCES (learned from this physician's past edits to ${scopeLabel}):`,
    "Apply these to wording, formatting, ordering, abbreviations, and level of detail ONLY.",
    "They must NEVER add, remove, or alter clinical facts, and they must never change the required output format. When a preference conflicts with earlier style guidance, the preference wins.",
    ...rules.map((r) => `- ${r}`),
  ].join("\n");
}

const NOTE_TYPE_LABELS: Record<StyleRuleNoteType, string> = {
  soap: "SOAP notes",
  recommendations_imaging: "imaging requisition recommendations",
  recommendations_referrals: "specialist referral notes",
};

const DISTILLATION_SYSTEM_PROMPT = `You maintain a physician's personal style guide for AI-generated clinical documents.
You are given: the AI's ORIGINAL text, the physician's EDITED version, and the CURRENT rule list.
Compare original vs edited and infer the durable, generalizable style preferences the edits imply.
Return valid JSON only: {"rules": string[]} — the COMPLETE updated rule list (existing rules merged with new insights), most important first, maximum ${MAX_RULES_PER_TYPE} rules, each a single imperative sentence under ${MAX_RULE_LENGTH} characters (e.g. "Use metric units only", "Write the plan as numbered steps", "Never open sentences with 'Patient reports'").
Rules:
- Keep existing rules unless the new edits contradict them (then replace) or duplicate them (then merge).
- Only include preferences that would apply to FUTURE notes for OTHER patients. Ignore one-off content edits (corrections of facts, added findings, patient-specific detail).
- CRITICAL: rules must contain ZERO patient-specific information — no names, initials, ages, dates, identifiers, diagnoses, medications, findings, or any clinical fact from this encounter. A rule that only makes sense for this patient must be discarded.
- Rules describe HOW to write (tone, structure, ordering, abbreviations, verbosity, phrasing), never WHAT clinical content to include for a specific case.
- If the edits imply no durable preference, return the existing rules unchanged.
Do not include markdown, code fences, or extra keys.`;

export function buildDistillationMessages(params: {
  noteType: StyleRuleNoteType;
  originalText: string;
  editedText: string;
  existingRules: string[];
}): { role: "system" | "user"; content: string }[] {
  const currentRules = params.existingRules.length
    ? params.existingRules.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "(none)";
  const userContent = [
    `Document type: ${NOTE_TYPE_LABELS[params.noteType]}`,
    "",
    "CURRENT RULES:",
    currentRules,
    "",
    "ORIGINAL (AI):",
    params.originalText,
    "",
    "EDITED (physician):",
    params.editedText,
  ].join("\n");
  return [
    { role: "system", content: DISTILLATION_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
