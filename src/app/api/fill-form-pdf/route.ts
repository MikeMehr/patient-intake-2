/**
 * GET /api/fill-form-pdf?code={sessionCode}
 * Returns the original uploaded form PDF with patient interview answers filled in.
 * Uses Azure Document Intelligence (prebuilt-layout) to detect field positions,
 * then Azure OpenAI to intelligently map interview answers to form fields.
 * Requires an authenticated physician session with access to the given session.
 */

import { type NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getCurrentSession } from "@/lib/auth";
import { getSession } from "@/lib/session-store";
import { canAccessSessionInScope, loadSessionAccessScope } from "@/lib/session-access";
import { query } from "@/lib/db";
import { buildFilledFormPdf, sanitiseFilename, extractAcroTextFields } from "@/lib/fill-form-pdf";
import type { FieldLocation, AcroFieldMapping } from "@/lib/fill-form-pdf";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { assertSafeOutboundUrl, assertSafeOperationLocation } from "@/lib/outbound-url";
import { ensureProdEnv } from "@/lib/required-env";
import { getAzureOpenAIClient } from "@/lib/azure-openai";

// ---------------------------------------------------------------------------
// Types for DI response
// ---------------------------------------------------------------------------

interface DIPage {
  pageNumber: number;
  width: number;
  height: number;
  unit?: string;
}

interface DIWord {
  content: string;
  polygon: number[];
}

interface DILine {
  content: string;
  polygon: number[];
  words?: DIWord[];
}

interface DIPageExtended extends DIPage {
  lines?: DILine[];
  words?: DIWord[];
}

interface DIBoundingRegion {
  pageNumber: number;
  polygon: number[];
}

interface DIKeyValuePair {
  key?: { content?: string; boundingRegions?: DIBoundingRegion[] };
  value?: { content?: string; boundingRegions?: DIBoundingRegion[] };
}

interface DIAnalyzeResult {
  pages?: DIPageExtended[];
  keyValuePairs?: DIKeyValuePair[];
}

// ---------------------------------------------------------------------------
// Step 1: Analyze PDF with Document Intelligence (prebuilt-layout + KVPs)
// ---------------------------------------------------------------------------

async function analyzeFormLayout(pdfBytes: Buffer): Promise<{
  pages: DIPageExtended[];
  keyValuePairs: DIKeyValuePair[];
}> {
  ensureProdEnv(["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "AZURE_DOCUMENT_INTELLIGENCE_API_KEY"]);
  const rawEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const apiKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY;
  const apiVersion = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || "2024-11-30";

  if (!rawEndpoint || !apiKey) return { pages: [], keyValuePairs: [] };

  const endpoint = assertSafeOutboundUrl(rawEndpoint.replace(/\/$/, ""), {
    label: "Document Intelligence endpoint",
  })
    .toString()
    .replace(/\/$/, "");

  // prebuilt-layout with keyValuePairs feature (prebuilt-document was removed in 2024-11-30)
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${encodeURIComponent(apiVersion)}&features=keyValuePairs`;

  const startResponse = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/pdf",
    },
    body: new Uint8Array(pdfBytes),
  });

  if (!startResponse.ok) {
    const body = await startResponse.text().catch(() => "");
    console.warn("[fill-form-pdf] DI analyze request failed:", startResponse.status, body);
    return { pages: [], keyValuePairs: [] };
  }

  const operationLocation =
    startResponse.headers.get("operation-location") ||
    startResponse.headers.get("Operation-Location");
  if (!operationLocation) return { pages: [], keyValuePairs: [] };

  const safeOpLoc = assertSafeOperationLocation(operationLocation, endpoint);

  // Poll for result (up to 90s)
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const pollRes = await fetch(safeOpLoc.toString(), {
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
    });
    if (!pollRes.ok) return { pages: [], keyValuePairs: [] };

    const payload = (await pollRes.json()) as {
      status?: string;
      analyzeResult?: DIAnalyzeResult;
    };

    const st = (payload.status || "").toLowerCase();
    if (st === "succeeded") {
      return {
        pages: (payload.analyzeResult?.pages || []) as DIPageExtended[],
        keyValuePairs: payload.analyzeResult?.keyValuePairs || [],
      };
    }
    if (st === "failed") {
      console.warn("[fill-form-pdf] DI analysis failed");
      return { pages: [], keyValuePairs: [] };
    }
  }

  console.warn("[fill-form-pdf] DI analysis timed out");
  return { pages: [], keyValuePairs: [] };
}

// ---------------------------------------------------------------------------
// Step 2: Use Azure OpenAI to map form answers → DI field positions
// ---------------------------------------------------------------------------

interface TextFieldCandidate {
  index: number;
  keyText: string;
  pageNumber: number;
  valueBounds: DIBoundingRegion | null;
  keyBounds: DIBoundingRegion | null;
  hasValueArea: boolean; // true when a blank value region was detected
}

async function mapAnswersToFields(
  formAnswers: { question: string; answer: string }[],
  candidates: TextFieldCandidate[],
): Promise<Array<{ answerIndex: number; fieldIndex: number; formattedValue?: string }>> {
  if (candidates.length === 0 || formAnswers.length === 0) return [];

  const azure = getAzureOpenAIClient();

  // Build the prompt with field labels and form Q&A
  const fieldLabels = candidates
    .map((c) => `  ${c.index}. [page ${c.pageNumber}] "${c.keyText}"${c.hasValueArea ? " [has blank area]" : " [key only]"}`)
    .join("\n");

  const qaPairs = formAnswers
    .map((qa, i) => `  ${i}. Q: ${qa.question}\n     A: ${qa.answer}`)
    .join("\n");

  const systemPrompt = `You are mapping patient interview answers to a medical intake form's field labels.
Form labels use clinical shorthand; interview questions use natural language. They often mean the same thing expressed differently.

Examples of equivalent pairs (form label ↔ interview question):
- "C/C:" or "Chief Complaint:" ↔ "What brings you in today?"
- "Date of Injury:" or "DOI:" ↔ "When did your injury occur?"
- "Mechanism of Injury:" or "MOI:" ↔ "How did the injury happen?"
- "Current Medications:" or "Meds:" ↔ "Are you taking any medications?"
- "Allergies:" or "NKA:" ↔ "Do you have any allergies?"
- "Past Medical History:" or "PMH:" ↔ "Do you have any past medical conditions?"
- "Date of Birth:" or "DOB:" ↔ "What is your date of birth?"
- "Referring Physician:" ↔ "Who referred you?"

Rules:
- Use your medical knowledge to match clinical abbreviations and shorthand to interview answers.
- When in doubt between two fields for the same answer, include both — the physician will review.
- Prefer fields marked [has blank area] over [key only] when both could match.
- Only map to TEXT fields — skip checkbox-type fields (Yes/No/Left/Right/Full/Modified etc.)
- If a field label specifies a date format like (dd/mmm/yyyy), reformat the answer to match.
- Only skip an answer if it explicitly says "Not discussed during interview" or "Not applicable".
- One answer may map to multiple fields (e.g. symptoms might fill both subjective findings and diagnosis).
- Return ONLY a JSON array, no other text.

Return format:
[{"answerIndex": 0, "fieldIndex": 1, "formattedValue": "17/Mar/2025"}, ...]

The "formattedValue" is optional — include it only when the answer needs reformatting (e.g. dates).
If omitted, the raw answer text will be used.`;

  const userPrompt = `Form field labels:\n${fieldLabels}\n\nInterview Q&A:\n${qaPairs}`;

  try {
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 2000,
      temperature: 0.2,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "[]";
    // Extract JSON from potential markdown code blocks
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      answerIndex: number;
      fieldIndex: number;
      formattedValue?: string;
    }>;

    // Validate and filter
    const validFieldIndices = new Set(candidates.map((c) => c.index));
    const result = parsed.filter(
      (m) =>
        typeof m.answerIndex === "number" &&
        typeof m.fieldIndex === "number" &&
        m.answerIndex >= 0 &&
        m.answerIndex < formAnswers.length &&
        validFieldIndices.has(m.fieldIndex),
    );

    console.log(`[fill-form-pdf] AI returned ${parsed.length} mappings, ${result.length} valid after filter`);
    return result;
  } catch (err) {
    console.warn("[fill-form-pdf] OpenAI mapping failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Step 2b: Use Azure OpenAI to map answers → AcroForm field names
// (used when the PDF has interactive AcroForm fields and DI is unavailable)
// ---------------------------------------------------------------------------

async function mapAnswersToAcroFields(
  formAnswers: { question: string; answer: string }[],
  acroFields: { name: string; tooltip: string }[],
): Promise<AcroFieldMapping[]> {
  if (acroFields.length === 0 || formAnswers.length === 0) return [];

  const azure = getAzureOpenAIClient();

  const fieldList = acroFields
    .map((f, i) => `  ${i}. name="${f.name}" label="${f.tooltip}"`)
    .join("\n");

  const qaPairs = formAnswers
    .map((qa, i) => `  ${i}. Q: ${qa.question}\n     A: ${qa.answer}`)
    .join("\n");

  const systemPrompt = `You are mapping patient interview answers into an interactive PDF form's fillable fields.
You will receive a list of PDF form fields (each with an internal name and a human-readable label) and a list of interview Q&A pairs.

Rules:
- Match each Q&A answer to the most appropriate form field.
- Prefer matching on the human-readable label; fall back to the internal name.
- Only map answers that are clearly relevant to the field — do not guess wildly.
- If an answer says "Not discussed" or "Not applicable", skip it.
- Dates: reformat to match common medical form conventions (e.g. YYYY-MM-DD or DD/MMM/YYYY).
- A single answer may fill multiple fields if they ask for the same information.
- Return ONLY a JSON array, no other text.

Return format:
[{"fieldName": "Text1", "answer": "value to fill"}, ...]

Use the exact internal field name (the "name" attribute, not the label).`;

  const userPrompt = `PDF form fields:\n${fieldList}\n\nPatient interview Q&A:\n${qaPairs}`;

  try {
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 2000,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "[]";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      fieldName: string;
      answer: string;
    }>;

    const validNames = new Set(acroFields.map((f) => f.name));
    return parsed.filter(
      (m) =>
        typeof m.fieldName === "string" &&
        typeof m.answer === "string" &&
        m.answer.trim() !== "" &&
        validNames.has(m.fieldName),
    );
  } catch (err) {
    console.warn("[fill-form-pdf] AcroForm OpenAI mapping failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Step 2c: Gap-based fallback — build candidates from blank regions between DI lines.
// Used when KVP detection returns too few candidates for a flat form.
//
// Many medical forms (e.g. CRA DTC questionnaire) have large BLANK areas below
// each prompt where the practitioner writes the answer. DI returns no content for
// these blank regions, so KVP detection finds nothing. This function finds those
// blank gaps by looking for large vertical spaces between consecutive DI text blocks
// that follow a "label" line (one ending with ":" or "?").
// ---------------------------------------------------------------------------

function buildCandidatesFromLines(
  pages: DIPageExtended[],
  startIndex: number,
): TextFieldCandidate[] {
  const candidates: TextFieldCandidate[] = [];
  let idx = startIndex;

  // Minimum blank gap (in DI coordinate units) to qualify as a fill area.
  // DI uses inches by default; 0.22 in ≈ 16 pts — larger than normal line-spacing
  // but small enough to catch compact fill areas.
  const MIN_GAP = 0.22;

  for (const page of pages) {
    const rawLines = page.lines || [];

    // Sort lines top-to-bottom by their minimum Y (DI Y increases downward from top).
    const lines = [...rawLines].sort((a, b) => {
      const aY = Math.min(a.polygon[1], a.polygon[3], a.polygon[5], a.polygon[7]);
      const bY = Math.min(b.polygon[1], b.polygon[3], b.polygon[5], b.polygon[7]);
      return aY - bY;
    });

    // Pre-compute bottom-Y for each line (max Y = bottom of line in DI coords).
    const lineBottoms = lines.map((l) =>
      Math.max(l.polygon[1], l.polygon[3], l.polygon[5], l.polygon[7]),
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const text = line.content?.trim() || "";
      if (!text || line.polygon.length < 8) continue;

      // Identify label / prompt lines:
      //   • ends with ":" or "?"   (e.g. "give examples specific to your patient:")
      //   • contains inline underscores (e.g. "Name: ___________")
      const isLabel = /[:?]\s*$/.test(text) || /:\s+_+/.test(text);
      if (!isLabel) continue;

      // Clean the label text (strip trailing colon/question-mark).
      const keyText = text.replace(/[:?]\s*$/, "").trim();
      if (keyText.length < 2) continue;

      const poly = line.polygon;
      const lineMinX = Math.min(poly[0], poly[2], poly[4], poly[6]);
      const lineMaxX = Math.max(poly[0], poly[2], poly[4], poly[6]);
      const lineBottom = lineBottoms[i]; // bottom edge of this label line

      // ── Option A: inline underscore words on this line ────────────────────
      let valueBounds: DIBoundingRegion | null = null;

      if (/_{3,}/.test(text) && page.words) {
        const lineMinY = Math.min(poly[1], poly[3], poly[5], poly[7]);
        const lineMaxY = lineBottom;
        const underscoreWords = page.words.filter((w) => {
          if (!/_+/.test(w.content) || w.polygon.length < 8) return false;
          const wY = Math.min(w.polygon[1], w.polygon[3], w.polygon[5], w.polygon[7]);
          return wY >= lineMinY - 1 && wY <= lineMaxY + 1;
        });
        if (underscoreWords.length > 0) {
          const allXs = underscoreWords.flatMap((w) => [w.polygon[0], w.polygon[2], w.polygon[4], w.polygon[6]]);
          const allYs = underscoreWords.flatMap((w) => [w.polygon[1], w.polygon[3], w.polygon[5], w.polygon[7]]);
          valueBounds = {
            pageNumber: page.pageNumber,
            polygon: [
              Math.min(...allXs), Math.min(...allYs),
              Math.max(...allXs), Math.min(...allYs),
              Math.max(...allXs), Math.max(...allYs),
              Math.min(...allXs), Math.max(...allYs),
            ],
          };
        }
      }

      // ── Option B: blank gap between this line and the next ────────────────
      // Walk forward through subsequent lines to find the next one that starts
      // far enough below — the intervening space is the fill area.
      if (!valueBounds) {
        // Find the top of the next text block that is meaningfully below us
        let gapStart = lineBottom;
        let gapEnd: number | null = null;

        for (let j = i + 1; j < lines.length; j++) {
          const nextPoly = lines[j].polygon;
          if (nextPoly.length < 8) continue;
          const nextTop = Math.min(nextPoly[1], nextPoly[3], nextPoly[5], nextPoly[7]);
          const gap = nextTop - gapStart;

          if (gap >= MIN_GAP) {
            gapEnd = nextTop;
            break;
          }
          // This next line is tightly spaced (part of the same paragraph) — advance gapStart.
          gapStart = Math.max(nextPoly[1], nextPoly[3], nextPoly[5], nextPoly[7]);
        }

        if (gapEnd !== null) {
          // Use the full horizontal extent of the label line (expanded to page margins)
          // so the overlay covers the typical answer area width.
          const fillX0 = Math.min(lineMinX, 0.35); // at most 0.35 in from left
          const fillX1 = Math.max(lineMaxX, (page.width || 8.27) - 0.35);
          valueBounds = {
            pageNumber: page.pageNumber,
            polygon: [
              fillX0, gapStart + 0.02,
              fillX1, gapStart + 0.02,
              fillX1, gapEnd - 0.02,
              fillX0, gapEnd - 0.02,
            ],
          };
        }
      }

      const keyBounds: DIBoundingRegion = { pageNumber: page.pageNumber, polygon: poly };

      candidates.push({
        index: idx++,
        keyText,
        pageNumber: page.pageNumber,
        valueBounds,
        keyBounds,
        hasValueArea: valueBounds !== null,
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Step 3: Convert DI coordinates → FieldLocation[]
// ---------------------------------------------------------------------------

function buildFieldLocations(
  mappings: Array<{ answerIndex: number; fieldIndex: number; formattedValue?: string }>,
  candidates: TextFieldCandidate[],
  formAnswers: { question: string; answer: string }[],
  pages: DIPageExtended[],
  pdfPageHeights: number[],
): FieldLocation[] {
  const locations: FieldLocation[] = [];
  const candidateMap = new Map(candidates.map((c) => [c.index, c]));

  for (const mapping of mappings) {
    const candidate = candidateMap.get(mapping.fieldIndex);
    if (!candidate) continue;

    const answer = mapping.formattedValue || formAnswers[mapping.answerIndex]?.answer;
    if (!answer?.trim()) continue;

    // Use value bounds if available, otherwise key bounds
    const bounds = candidate.valueBounds || candidate.keyBounds;
    if (!bounds?.polygon || bounds.polygon.length < 8) continue;

    const pageInfo = pages.find((p) => p.pageNumber === bounds.pageNumber);
    if (!pageInfo) continue;

    // Determine unit scale: DI reports in "inch" (default) or "pixel"
    const unitScale = pageInfo.unit === "pixel" ? 72 / 96 : 72; // → PDF points

    // Use actual pdf-lib page height for Y-flip so DI page size differences don't shift text.
    // pdfPageHeights is 0-based; bounds.pageNumber is 1-based.
    const pageIdx0 = bounds.pageNumber - 1;
    const pageHeightPts =
      pdfPageHeights[pageIdx0] !== undefined
        ? pdfPageHeights[pageIdx0]
        : pageInfo.height * unitScale;

    const poly = bounds.polygon;
    const xs = [poly[0], poly[2], poly[4], poly[6]];
    const ys = [poly[1], poly[3], poly[5], poly[7]];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    let x = minX * unitScale;
    let y = pageHeightPts - maxY * unitScale;
    let width = (maxX - minX) * unitScale;
    let height = (maxY - minY) * unitScale;

    // If using key bounds (no value region), place answer directly below the key label.
    if (!candidate.valueBounds) {
      const labelBottomPdf = y;
      const answerAreaTop = labelBottomPdf - 2;
      const reservedH = Math.max(height * 3, 72);
      y = answerAreaTop - reservedH;
      width = Math.max(width, 300);
      height = reservedH;
    }

    // Sanity check: skip coordinates that land off-page (indicates unit conversion error)
    if (x < 0 || x > 2000 || y < -200 || y > pageHeightPts + 50) {
      console.warn(
        `[fill-form-pdf] Skipping field "${candidate.keyText}" — computed coords out of range: x=${x.toFixed(1)}, y=${y.toFixed(1)}, pageHeight=${pageHeightPts}`,
      );
      continue;
    }

    console.log(
      `[fill-form-pdf] Field "${candidate.keyText}" → x=${x.toFixed(1)}, y=${y.toFixed(1)}, w=${width.toFixed(1)}, h=${height.toFixed(1)}, page=${pageIdx0} (${candidate.valueBounds ? "value bounds" : "key bounds"})`,
    );

    locations.push({
      keyText: answer,
      pageIndex: pageIdx0,
      x,
      y,
      width,
      height: Math.max(height, 12),
    });
  }

  return locations;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when DI's detected value is "real" content the physician
 * already typed (e.g. a name, a valid date).  We skip those fields to avoid
 * overlaying patient-interview answers on top of intentionally pre-filled data.
 * Values like "undefined/undefined/", blank strings, checkbox marks, underscore
 * lines, or single punctuation characters are treated as empty so we DO fill them.
 */
function hasRealContent(val: string): boolean {
  if (!val || !val.trim()) return false;
  const lower = val.toLowerCase().trim();
  if (lower.includes("undefined")) return false;
  if (lower === "n/a" || lower === "na" || lower === "none" || lower === "-") return false;
  // Single character (punctuation artifact)
  if (lower.length === 1) return false;
  // All punctuation/whitespace/underscores — DI reading blank lines or fill-in underscores
  if (/^[_\-./,\s]+$/.test(lower)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  // Require authenticated physician session
  const authSession = await getCurrentSession();
  if (!authSession) {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }
  if ((authSession as { userType?: string }).userType !== "provider") {
    status = 403;
    const res = NextResponse.json({ error: "Only providers can download filled forms" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  const sessionCode = request.nextUrl.searchParams.get("code")?.trim() || null;
  if (!sessionCode) {
    status = 400;
    const res = NextResponse.json({ error: "code (session code) is required" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  // Verify physician can access this session
  const scope = await loadSessionAccessScope(sessionCode);
  if (!scope) {
    status = 404;
    const res = NextResponse.json({ error: "Session not found" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }
  if (!canAccessSessionInScope({ viewer: authSession, resource: scope })) {
    status = 403;
    const res = NextResponse.json({ error: "Access denied" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  const session = await getSession(sessionCode);
  if (!session) {
    status = 404;
    const res = NextResponse.json({ error: "Session not found" }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  // Ensure form answers have been generated
  const formAnswers = (session.history as any)?.formAnswers as
    | { question: string; answer: string }[]
    | undefined;
  if (!Array.isArray(formAnswers) || formAnswers.length === 0) {
    status = 400;
    const res = NextResponse.json(
      { error: "Form answers not yet generated. Please generate form answers first." },
      { status },
    );
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  // Fetch the stored PDF bytes
  const pdfResult = await query<{
    form_pdf_data: Buffer | null;
    form_pdf_filename: string | null;
  }>(
    `SELECT pi.form_pdf_data, pi.form_pdf_filename
     FROM patient_sessions ps
     JOIN patient_invitations pi
       ON pi.physician_id = ps.physician_id
       AND LOWER(pi.patient_email) = LOWER(ps.patient_email)
     WHERE ps.session_code = $1
       AND pi.form_pdf_data IS NOT NULL
       AND pi.form_pdf_deleted_at IS NULL
     ORDER BY pi.sent_at DESC NULLS LAST
     LIMIT 1`,
    [sessionCode],
  );

  if (pdfResult.rows.length === 0 || !pdfResult.rows[0].form_pdf_data) {
    status = 404;
    const res = NextResponse.json(
      {
        error:
          "The original form PDF is no longer available (it may have expired). " +
          "The text download is still available.",
      },
      { status },
    );
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }

  const { form_pdf_data, form_pdf_filename } = pdfResult.rows[0];

  try {
    // Pre-load the PDF to get actual page heights for accurate Y-coordinate flipping.
    // This avoids relying solely on DI's reported page dimensions (which can differ slightly).
    let pdfPageHeights: number[] = [];
    try {
      const pdfDocForSize = await PDFDocument.load(form_pdf_data!, { ignoreEncryption: true });
      pdfPageHeights = pdfDocForSize.getPages().map((p) => p.getSize().height);
      console.log(`[fill-form-pdf] PDF page heights (pts): [${pdfPageHeights.map((h) => h.toFixed(1)).join(", ")}]`);
    } catch {
      console.warn("[fill-form-pdf] Could not pre-read PDF page sizes; DI page heights will be used as fallback");
    }

    // Step 1a: Check for interactive AcroForm fields and use AI to map answers → fields.
    // This path works even without Azure Document Intelligence.
    let acroFieldMappings: AcroFieldMapping[] = [];
    try {
      const acroFields = await extractAcroTextFields(form_pdf_data!);
      console.log(`[fill-form-pdf] AcroForm text fields detected: ${acroFields.length}`);
      if (acroFields.length > 0) {
        acroFieldMappings = await mapAnswersToAcroFields(formAnswers, acroFields);
        console.log(`[fill-form-pdf] AI mapped ${acroFieldMappings.length} answers to AcroForm fields`);
      }
    } catch (acroErr) {
      console.warn("[fill-form-pdf] AcroForm field extraction/mapping failed:", acroErr);
    }

    // Step 1b: Analyze flat PDF layout with Document Intelligence (for non-AcroForm PDFs).
    // Only run if AcroForm mapping found no fields (avoids double-billing DI calls).
    let fieldLocations: FieldLocation[] = [];
    if (acroFieldMappings.length === 0) {
      try {
        const { pages, keyValuePairs } = await analyzeFormLayout(form_pdf_data!);
        console.log(`[fill-form-pdf] DI detected ${keyValuePairs.length} KVPs on ${pages.length} pages`);

        if (pages.length > 0) {
          const selectionValues = new Set([":selected:", ":unselected:"]);
          const checkboxKeys = new Set(["yes", "no", "left", "right", "bilat.", "none", "full", "modified"]);

          // Build KVP-based candidates
          const candidates: TextFieldCandidate[] = [];
          keyValuePairs.forEach((kvp, idx) => {
            const keyText = kvp.key?.content?.trim() || "";
            const valContent = kvp.value?.content?.trim() || "";
            if (!keyText) return;
            if (checkboxKeys.has(keyText.toLowerCase())) return;
            if (selectionValues.has(valContent)) return;
            if (hasRealContent(valContent)) return;

            candidates.push({
              index: idx,
              keyText,
              pageNumber: kvp.key?.boundingRegions?.[0]?.pageNumber || 1,
              valueBounds: kvp.value?.boundingRegions?.[0] || null,
              keyBounds: kvp.key?.boundingRegions?.[0] || null,
              hasValueArea: !!(kvp.value?.boundingRegions?.[0]),
            });
          });

          console.log(`[fill-form-pdf] KVP candidates after filtering: ${candidates.length} (raw KVPs: ${keyValuePairs.length})`);

          // If KVPs are insufficient for the number of form answers, supplement with
          // line-scan detection (catches fields DI didn't recognise as key-value pairs).
          const lineFallbackThreshold = Math.ceil(formAnswers.length / 3);
          if (candidates.length < lineFallbackThreshold) {
            const lineCandidates = buildCandidatesFromLines(pages, keyValuePairs.length);
            console.log(`[fill-form-pdf] KVP candidates (${candidates.length}) below threshold (${lineFallbackThreshold}); line-scan added ${lineCandidates.length} additional candidates`);
            candidates.push(...lineCandidates);
          }

          console.log(`[fill-form-pdf] Total candidates for AI mapping: ${candidates.length}`);

          if (candidates.length > 0) {
            // Step 2: Use OpenAI to map answers → DI fields
            const mappings = await mapAnswersToFields(formAnswers, candidates);
            console.log(`[fill-form-pdf] ${mappings.length} answer→field pairs after AI mapping`);

            // Step 3: Convert to FieldLocation[]
            fieldLocations = buildFieldLocations(mappings, candidates, formAnswers, pages, pdfPageHeights);
            console.log(`[fill-form-pdf] ${fieldLocations.length} field locations built for overlay`);
          }
        }
      } catch (diErr) {
        console.warn("[fill-form-pdf] DI/AI field analysis failed, using appended pages only", diErr);
      }
    }

    const filledBytes = await buildFilledFormPdf({
      pdfBytes: form_pdf_data!,
      formAnswers,
      metadata: {
        patientName: session.patientName || "Patient",
        sessionDate: session.completedAt ? new Date(session.completedAt) : new Date(),
        originalFilename: form_pdf_filename,
      },
      fieldLocations,
      acroFieldMappings,
    });

    const baseName = form_pdf_filename
      ? `filled-${sanitiseFilename(form_pdf_filename)}`
      : `filled-form-${(session.patientName || "patient").replace(/\s+/g, "-").toLowerCase()}.pdf`;

    status = 200;
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return new Response(Buffer.from(filledBytes), {
      status,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[fill-form-pdf] Failed to build filled PDF", err);
    status = 500;
    const res = NextResponse.json({ error: "Failed to generate filled PDF." }, { status });
    logRequestMeta("/api/fill-form-pdf", requestId, status, Date.now() - started);
    return res;
  }
}
