/**
 * GET /api/fill-form-pdf?code={sessionCode}
 * Returns the original uploaded form PDF with patient interview answers filled in.
 * Uses Azure Document Intelligence (prebuilt-layout) to detect field positions,
 * then Azure OpenAI to intelligently map interview answers to form fields.
 * Requires an authenticated physician session with access to the given session.
 */

import { type NextRequest, NextResponse } from "next/server";
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

interface DIBoundingRegion {
  pageNumber: number;
  polygon: number[];
}

interface DIKeyValuePair {
  key?: { content?: string; boundingRegions?: DIBoundingRegion[] };
  value?: { content?: string; boundingRegions?: DIBoundingRegion[] };
}

interface DIAnalyzeResult {
  pages?: DIPage[];
  keyValuePairs?: DIKeyValuePair[];
}

// ---------------------------------------------------------------------------
// Step 1: Analyze PDF with Document Intelligence (prebuilt-layout + KVPs)
// ---------------------------------------------------------------------------

async function analyzeFormLayout(pdfBytes: Buffer): Promise<{
  pages: DIPage[];
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
        pages: payload.analyzeResult?.pages || [],
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
}

async function mapAnswersToFields(
  formAnswers: { question: string; answer: string }[],
  candidates: TextFieldCandidate[],
): Promise<Array<{ answerIndex: number; fieldIndex: number; formattedValue?: string }>> {
  if (candidates.length === 0 || formAnswers.length === 0) return [];

  const azure = getAzureOpenAIClient();

  // Build the prompt with field labels and form Q&A
  const fieldLabels = candidates
    .map((c) => `  ${c.index}. [page ${c.pageNumber}] "${c.keyText}"`)
    .join("\n");

  const qaPairs = formAnswers
    .map((qa, i) => `  ${i}. Q: ${qa.question}\n     A: ${qa.answer}`)
    .join("\n");

  const systemPrompt = `You are mapping patient interview answers to a medical form's field labels.
You will receive a list of form field labels (detected from a PDF form) and a list of interview Q&A pairs.

Rules:
- Map each interview answer to the form field label(s) it should fill.
- Only map to TEXT fields — skip checkbox-type fields (Yes/No/Left/Right/Full/Modified etc.)
- If a field label specifies a date format like (dd/mmm/yyyy), reformat the answer to match.
- If an answer says "Not discussed during interview" or "Not applicable", skip it.
- If no good match exists for an answer, omit it.
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
    return parsed.filter(
      (m) =>
        typeof m.answerIndex === "number" &&
        typeof m.fieldIndex === "number" &&
        m.answerIndex >= 0 &&
        m.answerIndex < formAnswers.length &&
        candidates.some((c) => c.index === m.fieldIndex),
    );
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
// Step 3: Convert DI coordinates → FieldLocation[]
// ---------------------------------------------------------------------------

function buildFieldLocations(
  mappings: Array<{ answerIndex: number; fieldIndex: number; formattedValue?: string }>,
  candidates: TextFieldCandidate[],
  formAnswers: { question: string; answer: string }[],
  pages: DIPage[],
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

    const unitScale = pageInfo.unit === "pixel" ? 72 / 96 : 72; // inches → points
    const pageHeightPts = pageInfo.height * unitScale;

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

    // If using key bounds (no value region), place below the key
    if (!candidate.valueBounds) {
      y -= height + 2;
      width = Math.max(width, 350);
      height = Math.max(height, 40);
    }

    locations.push({
      keyText: answer, // Store the ANSWER text (not the key) for the builder to draw
      pageIndex: bounds.pageNumber - 1,
      x,
      y,
      width,
      height: Math.max(height, 12),
    });
  }

  return locations;
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

        if (keyValuePairs.length > 0) {
          // Filter to text-field candidates (skip selection marks / checkboxes)
          const selectionValues = new Set([":selected:", ":unselected:"]);
          const checkboxKeys = new Set(["yes", "no", "left", "right", "bilat.", "none", "full", "modified"]);

          const candidates: TextFieldCandidate[] = [];
          keyValuePairs.forEach((kvp, idx) => {
            const keyText = kvp.key?.content?.trim() || "";
            const valContent = kvp.value?.content?.trim() || "";
            if (!keyText) return;
            // Skip checkbox/radio fields
            if (checkboxKeys.has(keyText.toLowerCase())) return;
            if (selectionValues.has(valContent)) return;

            candidates.push({
              index: idx,
              keyText,
              pageNumber: kvp.key?.boundingRegions?.[0]?.pageNumber || 1,
              valueBounds: kvp.value?.boundingRegions?.[0] || null,
              keyBounds: kvp.key?.boundingRegions?.[0] || null,
            });
          });

          console.log(`[fill-form-pdf] ${candidates.length} text-field candidates for AI mapping`);

          // Step 2: Use OpenAI to map answers → DI fields
          const mappings = await mapAnswersToFields(formAnswers, candidates);
          console.log(`[fill-form-pdf] AI mapped ${mappings.length} answer→DI field pairs`);

          // Step 3: Convert to FieldLocation[]
          fieldLocations = buildFieldLocations(mappings, candidates, formAnswers, pages);
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
