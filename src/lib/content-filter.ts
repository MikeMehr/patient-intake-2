import type OpenAI from "openai";

/**
 * Helpers for turning Azure OpenAI content-filter blocks into actionable
 * feedback: which harm category tripped, and (best effort) which passage of
 * the transcript did it, so the physician can choose to generate anyway
 * without that passage.
 *
 * Azure reports the category/severity of a block but never the text offsets,
 * so location is recovered by probing each paragraph individually with a
 * minimal completion request (input tokens only — a blocked probe fails
 * before any output is generated).
 */

export type ContentFilterCategory = { category: string; severity: string };

export type FlaggedSegment = {
  /** Character offset of the segment in the original transcript. */
  start: number;
  end: number;
  text: string;
  categories: ContentFilterCategory[];
};

export type ContentFilterPayload = {
  error: string;
  contentFilter: {
    categories: ContentFilterCategory[];
    segments: FlaggedSegment[];
  };
};

const CATEGORY_LABELS: Record<string, string> = {
  self_harm: "self-harm",
  selfharm: "self-harm",
  hate: "hate",
  sexual: "sexual content",
  violence: "violence",
  jailbreak: "prompt-injection (jailbreak)",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category.toLowerCase()] || category;
}

type FilterResultMap = Record<string, { filtered?: boolean; detected?: boolean; severity?: string } | undefined>;

function categoriesFromResultMap(map: unknown): ContentFilterCategory[] {
  if (!map || typeof map !== "object") return [];
  const out: ContentFilterCategory[] = [];
  for (const [category, value] of Object.entries(map as FilterResultMap)) {
    if (value && (value.filtered === true || value.detected === true)) {
      out.push({ category, severity: value.severity || "unknown" });
    }
  }
  return out;
}

/**
 * Extracts tripped categories from an Azure OpenAI 400 content-filter error
 * (error.error.innererror.content_filter_result).
 */
export function categoriesFromApiError(error: unknown): ContentFilterCategory[] {
  const errBody = (error as Record<string, unknown> | null)?.error as Record<string, unknown> | undefined;
  const inner = errBody?.innererror as Record<string, unknown> | undefined;
  return categoriesFromResultMap(inner?.content_filter_result);
}

/**
 * Extracts tripped categories from a completion choice whose finish_reason is
 * "content_filter" (Azure attaches content_filter_results to the choice).
 */
export function categoriesFromChoice(choice: unknown): ContentFilterCategory[] {
  const results = (choice as Record<string, unknown> | null)?.content_filter_results;
  return categoriesFromResultMap(results);
}

/** Splits a transcript into probe-able segments with original offsets. */
function splitIntoSegments(transcript: string): Array<{ start: number; end: number; text: string }> {
  const segments: Array<{ start: number; end: number; text: string }> = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g; // paragraph = run of lines not separated by a blank line
  let match: RegExpExecArray | null;
  while ((match = re.exec(transcript)) !== null) {
    const text = match[0].trim();
    if (text.length < 8) continue; // too short to be a meaningful flag target
    segments.push({ start: match.index, end: match.index + match[0].length, text });
  }
  // A transcript pasted as one giant block: fall back to sentence groups of ~3
  if (segments.length === 1 && segments[0].text.length > 600) {
    const only = segments[0];
    segments.length = 0;
    const sentenceRe = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
    let group: { start: number; end: number } | null = null;
    let count = 0;
    while ((match = sentenceRe.exec(only.text)) !== null) {
      const absStart = only.start + match.index;
      const absEnd = absStart + match[0].length;
      if (!group) group = { start: absStart, end: absEnd };
      group.end = absEnd;
      count++;
      if (count === 3) {
        segments.push({ ...group, text: transcript.slice(group.start, group.end).trim() });
        group = null;
        count = 0;
      }
    }
    if (group) segments.push({ ...group, text: transcript.slice(group.start, group.end).trim() });
  }
  return segments;
}

const MAX_PROBED_SEGMENTS = 40;
const PROBE_CONCURRENCY = 4;

/**
 * Best-effort location of the passage(s) that trip the content filter, by
 * probing each paragraph as its own minimal request. Returns [] when no single
 * passage trips it on its own (the block was an aggregate effect) or when
 * probing fails entirely.
 */
export async function locateFlaggedSegments(
  transcript: string,
  client: OpenAI,
  deployment: string,
): Promise<FlaggedSegment[]> {
  const segments = splitIntoSegments(transcript).slice(0, MAX_PROBED_SEGMENTS);
  const flagged: FlaggedSegment[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < segments.length) {
      const segment = segments[cursor++];
      try {
        const completion = await client.chat.completions.create({
          model: deployment,
          messages: [{ role: "user", content: segment.text }],
          max_completion_tokens: 1,
        });
        const choice = completion.choices?.[0];
        if (choice?.finish_reason === "content_filter") {
          flagged.push({ ...segment, categories: categoriesFromChoice(choice) });
        }
      } catch (error) {
        const status = (error as { status?: number } | null)?.status;
        if (status === 400) {
          const categories = categoriesFromApiError(error);
          if (categories.length > 0 || JSON.stringify((error as Error)?.message || "").toLowerCase().includes("content_filter")) {
            flagged.push({ ...segment, categories });
          }
        }
        // Any other probe failure (rate limit, transient) — skip the segment.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, segments.length) }, () => worker()));
  return flagged.sort((a, b) => a.start - b.start);
}

/**
 * Builds the 422 payload for a content-filter block: a specific human message
 * plus structured detail the UI uses to highlight passages and offer
 * "generate anyway without the flagged text".
 */
export async function buildContentFilterPayload(options: {
  transcript: string;
  categories: ContentFilterCategory[];
  client?: OpenAI;
  deployment?: string;
}): Promise<ContentFilterPayload> {
  const { transcript, categories, client, deployment } = options;
  const segments = client && deployment ? await locateFlaggedSegments(transcript, client, deployment) : [];

  // Prefer per-segment categories when the whole-request block didn't report any
  const allCategories = categories.length > 0
    ? categories
    : dedupeCategories(segments.flatMap((s) => s.categories));

  const catText = allCategories.length > 0
    ? allCategories.map((c) => `${categoryLabel(c.category)}${c.severity && c.severity !== "unknown" ? ` (${c.severity} severity)` : ""}`).join(", ")
    : "an unspecified category";

  let message = `The AI safety filter flagged this transcript for ${catText}.`;
  if (segments.length > 0) {
    message += segments.length === 1
      ? " The flagged passage is shown below — you can generate anyway without it, or edit the transcript and retry."
      : ` ${segments.length} flagged passages are shown below — you can generate anyway without them, or edit the transcript and retry.`;
  } else {
    message += " No single passage could be pinpointed — the wording across the transcript tripped the filter together. Edit or trim the strongest language and try again.";
  }

  return { error: message, contentFilter: { categories: allCategories, segments } };
}

function dedupeCategories(categories: ContentFilterCategory[]): ContentFilterCategory[] {
  const byCategory = new Map<string, ContentFilterCategory>();
  for (const c of categories) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, c);
  }
  return [...byCategory.values()];
}

/** True when an Azure OpenAI 400 error is a content-filter (RAI) block. */
export function isContentFilterError(error: unknown): boolean {
  const errBody = (error as Record<string, unknown> | null)?.error as Record<string, unknown> | undefined;
  const code = errBody?.code as string | undefined;
  const innerCode = (errBody?.innererror as Record<string, unknown>)?.code as string | undefined;
  return (
    code === "content_filter" ||
    innerCode === "ResponsibleAIPolicyViolation" ||
    (error instanceof Error && error.message.toLowerCase().includes("content_filter"))
  );
}
