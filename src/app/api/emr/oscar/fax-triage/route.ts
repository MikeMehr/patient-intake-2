/**
 * Suggest how an incoming fax should be filed in OSCAR's Incoming Docs screen.
 *
 * NOTE THE DIRECTION. Like /api/emr/oscar/billing-dx and unlike every other route under
 * /api/emr/oscar, this one is called *in* by the OSCAR box (mymd/faxSuggest.jsp) and is
 * authenticated by a shared secret, not by a physician session — there is no browser and no cookie
 * on that call path.
 *
 * It exists so that clinical documents have exactly one road out of the clinic: this app, the Azure
 * deployment covered by the vendor agreement, HIPAA_MODE, and physician_phi_audit_log. Calling
 * Azure straight from Tomcat would have meant a second key on the box and a second audit trail.
 *
 * Incoming faxes are raster scans with no text layer, so OCR (Azure Document Intelligence) is not
 * optional here — it is the only way to read them at all.
 *
 * What goes back is what the page says: a name, a date of birth, a health number, a study title.
 * It is deliberately NOT an OSCAR demographic_no or provider_no — the box resolves those against
 * its own tables, so a misread name fails to match rather than filing to the wrong chart.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { parseJsonValue } from "@/lib/safe-json";
import { extractFaxPages, pagesToPrompt } from "@/lib/fax/ocr";
import { query } from "@/lib/db";
import {
  buildFaxMessages,
  buildFaxSchema,
  emptySuggestion,
  validateFaxResponse,
  type FaxTriageSuggestion,
} from "@/lib/fax/triage";

const ROUTE = "/api/emr/oscar/fax-triage";
const SECRET_HEADER = "x-mymd-fax-secret";

/** More fields than a dx code, but still a physician waiting at a screen. */
const MAX_TOKENS = 700;

/** Matches assertValidPdfUpload's ceiling. A clinic fax is tens of kilobytes. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Below this, OCR found the page essentially blank — a cover sheet with a logo, or a scan too poor
 * to read. Calling the model on it invites confident nonsense, so we don't.
 */
const MIN_OCR_CHARS = 40;

/** Bound on what is sent to the model, page markers included. */
const MAX_PROMPT_CHARS = 30_000;

const requestSchema = z.object({
  /** Opaque per-file handle for logs and caching. Deliberately not a patient identifier. */
  faxRef: z.string().min(1).max(128),
  /** The scanned fax. Base64; ~1.34 chars per byte, so cap generously and check bytes after decode. */
  pdfBase64: z.string().min(1).max(Math.ceil(MAX_PDF_BYTES * 1.4)),
  /** OSCAR provider number of whoever is at the screen, used to attribute the audit row. */
  providerNo: z.string().min(1).max(12),
  /** Live ctl_doctype values. Become an enum, so the model cannot invent a type. */
  docTypes: z.array(z.string().min(1).max(40)).min(1).max(40),
  /** Live ctl_doc_class values. */
  docClasses: z.array(z.string().min(1).max(60)).max(40).default([]),
  /** Active providers, so the model can recognise who a fax is addressed to. */
  knownProviders: z
    .array(z.object({ name: z.string().min(1).max(80), mspNumber: z.string().max(12) }))
    .max(50)
    .default([]),
});

/** Constant-time compare that tolerates unequal lengths without leaking them. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function physicianIdForProvider(providerNo: string): Promise<string | null> {
  const res = await query<{ id: string }>(
    `SELECT id FROM physicians WHERE oscar_provider_no = $1 LIMIT 1`,
    [providerNo],
  );
  return res.rows[0]?.id ?? null;
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  const requestId = getRequestId(request.headers);
  const finish = (status: number, body: Record<string, unknown>) => {
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return NextResponse.json(body, { status });
  };
  /** Every non-fatal exit returns 200 with an empty suggestion: the screen falls back to manual. */
  const noSuggestion = (reason: string) => finish(200, { ...emptySuggestion(), reason });

  const expected = process.env.OSCAR_FAX_BRIDGE_SECRET;
  // Fail closed. With no secret configured this endpoint does not exist as far as callers know.
  if (!expected) return finish(404, { error: "Not found" });
  if (!secretMatches(request.headers.get(SECRET_HEADER), expected)) {
    return finish(401, { error: "Unauthorized" });
  }

  // The kill switch must not take fax filing down with it — the physician just types as before.
  if (process.env.HIPAA_MODE === "true") {
    return finish(503, { ...emptySuggestion(), reason: "hipaa_mode" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return finish(400, { error: "Malformed JSON body" });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return finish(400, { error: "Invalid request", detail: parsed.error.issues[0]?.message });
  }
  const { faxRef, pdfBase64, providerNo, docTypes, docClasses, knownProviders } = parsed.data;

  let pdfBytes: Buffer;
  try {
    pdfBytes = Buffer.from(pdfBase64, "base64");
  } catch {
    return finish(400, { error: "pdfBase64 is not valid base64" });
  }
  if (pdfBytes.length === 0) return finish(400, { error: "pdfBase64 decoded to nothing" });
  if (pdfBytes.length > MAX_PDF_BYTES) return finish(413, { error: "PDF exceeds 10MB limit" });
  // Cheap sanity check that we were handed a PDF and not, say, an HTML error page.
  if (pdfBytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return finish(400, { error: "Payload is not a PDF" });
  }

  const physicianId = await physicianIdForProvider(providerNo);
  const ipAddress = getRequestIp(request.headers);
  const userAgent = request.headers.get("user-agent");

  // --- OCR, page by page -------------------------------------------------------------------------
  // Page boundaries are kept so the model can cite where each patient appears; a fax carrying five
  // patients is only actionable if the physician is told where to split it.
  let pages: string[];
  let ocrText: string;
  try {
    pages = await extractFaxPages(pdfBytes);
    ocrText = pagesToPrompt(pages, MAX_PROMPT_CHARS);
  } catch (err) {
    console.error(`[${ROUTE}] ${requestId} OCR failed:`, err instanceof Error ? err.message : err);
    return noSuggestion("ocr_error");
  }

  if (ocrText.trim().length < MIN_OCR_CHARS) {
    await logPhysicianPhiAudit({
      physicianId,
      eventType: "oscar_fax_triage_no_suggestion",
      ipAddress,
      userAgent,
      metadata: { faxRef, providerNo, reason: "no_text", ocrChars: ocrText.trim().length },
    });
    return noSuggestion("no_text");
  }

  // --- Model -----------------------------------------------------------------------------------
  let suggestion: FaxTriageSuggestion;
  try {
    const azure = getAzureOpenAIClient();
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: buildFaxMessages(ocrText, docTypes, docClasses, knownProviders),
      // Pinned rather than inherited: an api-version without json_schema would silently drop the
      // enum constraint and let an off-list document type through.
      response_format: buildFaxSchema(docTypes, docClasses),
      max_completion_tokens: MAX_TOKENS,
    });

    const choice = completion.choices?.[0];
    if (choice?.finish_reason === "content_filter") {
      await logPhysicianPhiAudit({
        physicianId,
        eventType: "oscar_fax_triage_no_suggestion",
        ipAddress,
        userAgent,
        metadata: { faxRef, providerNo, reason: "content_filter" },
      });
      return noSuggestion("content_filter");
    }

    const raw = choice?.message?.content?.trim() || "";
    suggestion = validateFaxResponse(
      raw ? parseJsonValue(raw, "fax triage model output") : null,
      docTypes,
      docClasses,
    );
  } catch (err) {
    // Never break the filing screen on a model problem — the fax becomes a manual one.
    console.error(`[${ROUTE}] ${requestId} model call failed:`, err instanceof Error ? err.message : err);
    await logPhysicianPhiAudit({
      physicianId,
      eventType: "oscar_fax_triage_no_suggestion",
      ipAddress,
      userAgent,
      metadata: { faxRef, providerNo, reason: "model_error" },
    });
    return noSuggestion("model_error");
  }

  // The suggestion itself carries a patient name and health number. It goes back to the physician's
  // screen; only non-identifying facts about it are recorded here.
  await logPhysicianPhiAudit({
    physicianId,
    eventType: "oscar_fax_triage_suggested",
    ipAddress,
    userAgent,
    metadata: {
      faxRef,
      providerNo,
      documentType: suggestion.documentType,
      documentClass: suggestion.documentClass,
      confidence: suggestion.confidence,
      ocrChars: ocrText.length,
      pageCount: pages.length,
      patientCount: suggestion.patients.length,
      multiPatient: suggestion.multiPatient,
      hasPhn: Boolean(suggestion.patient.phn),
      hasDob: Boolean(suggestion.patient.dateOfBirth),
      hasAddressee: Boolean(suggestion.addressedTo.name || suggestion.addressedTo.mspNumber),
      physicianResolved: Boolean(physicianId),
    },
  });

  if (!physicianId) {
    console.error(`[${ROUTE}] ${requestId} no physician mapped to oscar_provider_no=${providerNo}`);
  }

  return finish(200, { ...suggestion, reason: "ok" });
}
