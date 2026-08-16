/**
 * OCR a fax into per-page text.
 *
 * `extractPdfTextWithAzureDocumentIntelligence` returns one flat string, which is all the other
 * PDF features need. A fax is different: one transmission routinely carries documents for several
 * patients, and telling the physician *which pages* to split at is most of the value of noticing.
 * That needs the page boundaries Document Intelligence already reports and the flat helper discards.
 *
 * Same endpoint, same model, same credentials — this reads `analyzeResult.pages` instead of
 * `analyzeResult.content`, so it is additive rather than a change to a shared code path.
 */

import { getDocumentIntelligenceConfig } from "@/lib/invitation-pdf-summary";

/** Document Intelligence stops being useful long before this; it is a bound, not a target. */
const MAX_POLL_ATTEMPTS = 45;
const POLL_INTERVAL_MS = 1000;

type AnalyzePage = {
  pageNumber?: number;
  spans?: Array<{ offset?: number; length?: number }>;
};

type AnalyzeResult = {
  status?: string;
  analyzeResult?: {
    content?: string;
    pages?: AnalyzePage[];
  };
};

/**
 * Slice the flat content string using each page's reported span.
 *
 * Falls back to a single entry holding everything when spans are missing — a one-page result is
 * still correct input for the model, it just cannot cite page numbers.
 */
function splitByPage(payload: AnalyzeResult): string[] {
  const content = payload.analyzeResult?.content ?? "";
  const pages = payload.analyzeResult?.pages ?? [];
  if (!content) return [];
  if (!pages.length) return [content];

  const out: string[] = [];
  for (const page of pages) {
    const span = page.spans?.[0];
    if (!span || typeof span.offset !== "number" || typeof span.length !== "number") continue;
    out.push(content.slice(span.offset, span.offset + span.length).trim());
  }
  return out.length ? out : [content];
}

async function poll(operationLocation: string, apiKey: string): Promise<AnalyzeResult> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const res = await fetch(operationLocation, {
      method: "GET",
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
    });
    if (!res.ok) throw new Error(`Azure Document Intelligence polling failed: HTTP ${res.status}`);
    const payload = (await res.json()) as AnalyzeResult;
    const status = (payload.status || "").toLowerCase();
    if (status === "succeeded") return payload;
    if (status === "failed") {
      throw new Error(
        `Azure Document Intelligence extraction failed: ${JSON.stringify(
          (payload as Record<string, unknown>).error ?? payload,
        )}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Azure Document Intelligence timed out while extracting fax text.");
}

/** Returns one string per page, in order. Empty array when the scan yielded no text at all. */
export async function extractFaxPages(pdfBytes: Buffer): Promise<string[]> {
  const { endpoint, apiKey, apiVersion, modelId } = getDocumentIntelligenceConfig();
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/${encodeURIComponent(
    modelId,
  )}:analyze?api-version=${encodeURIComponent(apiVersion)}`;

  const startResponse = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/pdf",
    },
    body: new Uint8Array(pdfBytes),
  });

  if (!startResponse.ok) {
    let body = "";
    try {
      body = await startResponse.text();
    } catch {
      /* ignore */
    }
    throw new Error(`Azure Document Intelligence request failed: HTTP ${startResponse.status} ${body}`.trim());
  }

  const operationLocation =
    startResponse.headers.get("operation-location") || startResponse.headers.get("Operation-Location");
  if (!operationLocation) throw new Error("Azure Document Intelligence did not return operation location.");

  // The operation URL comes back from the same host we just called; keep it pinned there.
  const parsed = new URL(operationLocation);
  if (parsed.origin !== new URL(endpoint).origin) {
    throw new Error("Azure Document Intelligence returned an operation location on another host.");
  }

  return splitByPage(await poll(parsed.toString(), apiKey));
}

/** Page markers the model can quote back as a page range. */
export function pagesToPrompt(pages: string[], maxChars: number): string {
  const joined = pages.map((text, i) => `--- PAGE ${i + 1} ---\n${text}`).join("\n\n");
  return joined.slice(0, maxChars);
}
