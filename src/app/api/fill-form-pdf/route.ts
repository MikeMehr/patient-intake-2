/**
 * GET /api/fill-form-pdf?code={sessionCode}
 * Returns the original uploaded form PDF with patient interview answers filled in.
 * Uses Azure Document Intelligence to detect field positions on flat PDFs.
 * Requires an authenticated physician session with access to the given session.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getSession } from "@/lib/session-store";
import { canAccessSessionInScope, loadSessionAccessScope } from "@/lib/session-access";
import { query } from "@/lib/db";
import { buildFilledFormPdf, sanitiseFilename } from "@/lib/fill-form-pdf";
import type { FieldLocation } from "@/lib/fill-form-pdf";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { assertSafeOutboundUrl, assertSafeOperationLocation } from "@/lib/outbound-url";
import { ensureProdEnv } from "@/lib/required-env";

// ---------------------------------------------------------------------------
// Document Intelligence: detect key-value field positions on flat PDFs
// ---------------------------------------------------------------------------

async function analyzeFormFieldPositions(pdfBytes: Buffer): Promise<FieldLocation[]> {
  // Require DI credentials (same env vars as invitation-pdf-summary)
  ensureProdEnv(["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "AZURE_DOCUMENT_INTELLIGENCE_API_KEY"]);
  const rawEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const apiKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY;
  const apiVersion = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || "2024-11-30";

  if (!rawEndpoint || !apiKey) return [];

  const endpoint = assertSafeOutboundUrl(rawEndpoint.replace(/\/$/, ""), {
    label: "Document Intelligence endpoint",
  })
    .toString()
    .replace(/\/$/, "");

  // Use prebuilt-document model for key-value pair extraction (not prebuilt-read)
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-document:analyze?api-version=${encodeURIComponent(apiVersion)}`;

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
    return [];
  }

  const operationLocation =
    startResponse.headers.get("operation-location") ||
    startResponse.headers.get("Operation-Location");
  if (!operationLocation) return [];

  const safeOpLoc = assertSafeOperationLocation(operationLocation, endpoint);

  // Poll for result (up to 60s)
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const pollRes = await fetch(safeOpLoc.toString(), {
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
    });
    if (!pollRes.ok) return [];

    const payload = (await pollRes.json()) as {
      status?: string;
      analyzeResult?: {
        pages?: Array<{ pageNumber: number; width: number; height: number; unit?: string }>;
        keyValuePairs?: Array<{
          key?: { content?: string; boundingRegions?: Array<{ pageNumber: number; polygon: number[] }> };
          value?: { content?: string; boundingRegions?: Array<{ pageNumber: number; polygon: number[] }> };
        }>;
      };
    };

    const st = (payload.status || "").toLowerCase();
    if (st === "succeeded") {
      return parseKeyValuePairs(payload.analyzeResult);
    }
    if (st === "failed") {
      console.warn("[fill-form-pdf] DI analysis failed");
      return [];
    }
  }

  console.warn("[fill-form-pdf] DI analysis timed out");
  return [];
}

function parseKeyValuePairs(result: {
  pages?: Array<{ pageNumber: number; width: number; height: number; unit?: string }>;
  keyValuePairs?: Array<{
    key?: { content?: string; boundingRegions?: Array<{ pageNumber: number; polygon: number[] }> };
    value?: { content?: string; boundingRegions?: Array<{ pageNumber: number; polygon: number[] }> };
  }>;
} | undefined): FieldLocation[] {
  if (!result?.keyValuePairs || !result.pages) return [];

  const locations: FieldLocation[] = [];

  for (const kvp of result.keyValuePairs) {
    const keyContent = kvp.key?.content?.trim();
    if (!keyContent) continue;

    // Prefer value bounding region (where answer should go); fall back to key region
    const valueBounds = kvp.value?.boundingRegions?.[0];
    const keyBounds = kvp.key?.boundingRegions?.[0];
    const bounds = valueBounds || keyBounds;
    if (!bounds?.polygon || bounds.polygon.length < 8) continue;

    const pageInfo = result.pages.find((p) => p.pageNumber === bounds.pageNumber);
    if (!pageInfo) continue;

    // DI uses inches by default; convert factor to points
    const unitScale = (pageInfo.unit === "pixel") ? (72 / 96) : 72; // inches → points
    const pageHeightPts = pageInfo.height * unitScale;

    // Extract bounding box from polygon [x1,y1, x2,y2, x3,y3, x4,y4]
    const poly = bounds.polygon;
    const xs = [poly[0], poly[2], poly[4], poly[6]];
    const ys = [poly[1], poly[3], poly[5], poly[7]];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // Convert from DI coords (top-left origin, inches) to PDF coords (bottom-left, points)
    let x = minX * unitScale;
    let y = pageHeightPts - maxY * unitScale; // flip Y
    let width = (maxX - minX) * unitScale;
    let height = (maxY - minY) * unitScale;

    // If we used the key bounds (no value region found), offset below the key text
    if (!valueBounds) {
      y -= height + 2;
      width = Math.max(width, 200);
    }

    locations.push({
      keyText: keyContent,
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

  // Fetch the stored PDF bytes from the invitation linked to this patient session.
  // JOIN on physician_id + patient_email since patient_sessions has no invitation_id FK.
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
    // Analyze the PDF with Document Intelligence to detect field positions.
    // This is best-effort; if it fails, we still get the appended response pages.
    let fieldLocations: FieldLocation[] = [];
    try {
      fieldLocations = await analyzeFormFieldPositions(form_pdf_data!);
      console.log(
        `[fill-form-pdf] DI detected ${fieldLocations.length} key-value fields`,
      );
    } catch (diErr) {
      console.warn("[fill-form-pdf] DI field analysis failed, using appended pages only", diErr);
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
