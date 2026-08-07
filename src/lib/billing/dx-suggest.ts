/**
 * Pick the diagnostic code for an MSP claim from an encounter note.
 *
 * The model never writes a code — it *chooses* one from a list assembled on the OSCAR box out of
 * OSCAR's own tables. The list is carried in a `json_schema` enum so an off-list answer is
 * structurally impossible rather than merely unlikely, and the result is re-checked here and again
 * on the box before it can reach a claim.
 *
 * Nothing in this module knows who the patient is. It is handed note text that has already been
 * redacted on the box, and it returns a code.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/** A diagnostic code the patient could plausibly be billed under, from OSCAR's icd9 table. */
export type DxCandidate = { code: string; description: string };

export type DxConfidence = "high" | "medium" | "low";

export type DxSuggestion = {
  /** A code from the candidate list, or NO_MATCH. */
  code: string;
  confidence: DxConfidence;
  /** A short quote from the note supporting the choice. Shown to the physician; never logged. */
  evidence: string;
};

/** Returned when nothing in the list fits. Not a code — callers must route this to manual entry. */
export const NO_MATCH = "NONE";

/**
 * Cap on codes offered to the model. Keeps the enum (and the prompt) small enough to stay sharp;
 * the box ranks candidates before truncating, so the ones most likely to be right survive.
 */
export const MAX_CANDIDATES = 60;

const SYSTEM_PROMPT = [
  "You assign the diagnostic code for a British Columbia MSP claim.",
  "",
  "You are given the assessment portion of a physician's encounter note and a list of permitted",
  "diagnostic codes. Choose the single code from the list that best matches the diagnosis the",
  "physician actually recorded.",
  "",
  "Rules:",
  "- Choose only from the supplied list. If none of them fits, answer NONE.",
  "- Code the diagnosis the physician settled on, not a symptom mentioned in passing and not a",
  "  condition that was ruled out.",
  "- If the note records only a symptom and no diagnosis, choose the symptom code if the list has",
  "  one; otherwise answer NONE.",
  "- Prefer a code the patient already carries when the note is consistent with it.",
  "- Prefer the least specific code that is still accurate. BC MSP's diagnostic list is mostly",
  "  3-digit, so a broader code is more likely to be accepted than a narrower one, and a broader",
  "  code claims less about the patient than the record supports.",
  "- Answer NONE rather than guessing. A missing code costs a moment of the physician's time; a",
  "  wrong one goes onto a government claim.",
  "- confidence: high when the note names the diagnosis plainly, medium when you inferred it from",
  "  clear clinical detail, low when the note is thin or ambiguous.",
  "- evidence: quote at most 15 words from the note that justify the choice. Quote, do not",
  "  paraphrase. Leave empty when answering NONE.",
].join("\n");

/**
 * JSON schema whose `code` enum is exactly the candidate list plus NONE, so the model cannot
 * return anything else.
 */
export function buildDxSchema(candidates: DxCandidate[]) {
  const codes = candidates.map((c) => c.code);
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "msp_diagnostic_code",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["code", "confidence", "evidence"],
        properties: {
          code: { type: "string", enum: [...codes, NO_MATCH] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidence: { type: "string" },
        },
      },
    },
  };
}

export function buildDxMessages(noteText: string, candidates: DxCandidate[]): ChatCompletionMessageParam[] {
  const list = candidates.map((c) => `${c.code}  ${c.description}`).join("\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "Permitted diagnostic codes:",
        list,
        "",
        "Encounter note:",
        noteText,
      ].join("\n"),
    },
  ];
}

/**
 * Re-check the model's answer against the candidate list.
 *
 * `strict` schemas make an off-list code very unlikely, but this is the boundary between a language
 * model and a government billing claim, so it is checked rather than trusted. The box checks again
 * against its own database — this is the cheaper of the two guards, not the last one.
 */
export function validateDxResponse(raw: unknown, candidates: DxCandidate[]): DxSuggestion {
  const allowed = new Set(candidates.map((c) => c.code));
  const noMatch: DxSuggestion = { code: NO_MATCH, confidence: "low", evidence: "" };

  if (!raw || typeof raw !== "object") return noMatch;
  const obj = raw as Record<string, unknown>;

  const code = typeof obj.code === "string" ? obj.code.trim() : "";
  if (!code || code === NO_MATCH || !allowed.has(code)) return noMatch;

  const confidence: DxConfidence =
    obj.confidence === "high" || obj.confidence === "medium" || obj.confidence === "low"
      ? obj.confidence
      : "low";

  // Trim rather than reject: an over-long quote is a formatting slip, not a reason to lose the code.
  const evidence = typeof obj.evidence === "string" ? obj.evidence.trim().slice(0, 200) : "";

  return { code, confidence, evidence };
}

/**
 * Rank and truncate the candidate list.
 *
 * Codes the patient already carries come first — they are both the likeliest answer and what
 * OSCAR's own billing form offers the physician. Codes this clinic has billed before come next:
 * MSP has already accepted those, which is the only real evidence available that a code is
 * billable here.
 */
export function rankCandidates(input: {
  patientDx: DxCandidate[];
  clinicHistory: DxCandidate[];
  keywordMatches: DxCandidate[];
}): DxCandidate[] {
  const seen = new Set<string>();
  const out: DxCandidate[] = [];
  for (const group of [input.patientDx, input.clinicHistory, input.keywordMatches]) {
    for (const c of group) {
      if (!c?.code || seen.has(c.code)) continue;
      seen.add(c.code);
      out.push(c);
      if (out.length >= MAX_CANDIDATES) return out;
    }
  }
  return out;
}
