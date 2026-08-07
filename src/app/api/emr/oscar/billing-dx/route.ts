/**
 * Diagnostic-code suggestion for OSCAR's day-billing sweep.
 *
 * NOTE THE DIRECTION. Every other route under /api/emr/oscar reaches *out* to OSCAR. This one is
 * called *in* by the OSCAR box (mymd.billing.DxClient) and is authenticated by a shared secret, not
 * by a physician session — there is no browser and no cookie on that call path.
 *
 * It exists so that clinical text has exactly one road out of the clinic: this app, the Azure
 * deployment covered by the vendor agreement, HIPAA_MODE, and physician_phi_audit_log. Calling
 * Azure straight from Tomcat would have meant a second key on the box and a second audit trail.
 *
 * What arrives here is already redacted on the box and carries no name, no card number and no date
 * of birth — see docs/oscar/day-billing-install.md. What goes back is a code, a confidence and a
 * short quote. The box re-validates the code against its own tables before it can reach a claim.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { getRequestIp } from "@/lib/invitation-security";
import { logPhysicianPhiAudit } from "@/lib/phi-audit";
import { parseJsonValue } from "@/lib/safe-json";
import { query } from "@/lib/db";
import {
  buildDxMessages,
  buildDxSchema,
  validateDxResponse,
  MAX_CANDIDATES,
  NO_MATCH,
  type DxSuggestion,
} from "@/lib/billing/dx-suggest";

const ROUTE = "/api/emr/oscar/billing-dx";
const SECRET_HEADER = "x-mymd-billing-secret";

/** The physician is watching a day sweep run; a slow model call is worse than a manual row. */
const MAX_TOKENS = 300;

const requestSchema = z.object({
  /** Groups every row of one sweep, on both sides of the wire. */
  runId: z.string().min(1).max(64),
  /** Opaque per-row handle. Meaningless outside the run — deliberately not a patient identifier. */
  caseRef: z.string().min(1).max(64),
  /** OSCAR-internal integer. Recorded in the audit metadata so a chart can be traced. */
  demographicNo: z.number().int().positive(),
  /** OSCAR provider number, used to attribute the audit row to a physician. */
  providerNo: z.string().min(1).max(12),
  /** Redacted on the box before it was sent. */
  noteText: z.string().min(1).max(20_000),
  candidates: z
    .array(z.object({ code: z.string().min(1).max(10), description: z.string().max(200) }))
    .min(1)
    .max(MAX_CANDIDATES),
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

  const expected = process.env.OSCAR_BILLING_BRIDGE_SECRET;
  // Fail closed. With no secret configured this endpoint does not exist as far as callers know.
  if (!expected) return finish(404, { error: "Not found" });
  if (!secretMatches(request.headers.get(SECRET_HEADER), expected)) {
    return finish(401, { error: "Unauthorized" });
  }

  // The kill switch must not take the billing tool down with it: the box turns this into a row the
  // physician codes by hand, and the sweep carries on.
  if (process.env.HIPAA_MODE === "true") {
    return finish(503, { error: "AI suggestions are disabled", code: NO_MATCH, reason: "hipaa_mode" });
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
  const { runId, caseRef, demographicNo, providerNo, noteText, candidates } = parsed.data;

  const physicianId = await physicianIdForProvider(providerNo);
  const ipAddress = getRequestIp(request.headers);
  const userAgent = request.headers.get("user-agent");

  let suggestion: DxSuggestion;
  try {
    const azure = getAzureOpenAIClient();
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: buildDxMessages(noteText, candidates),
      // Pinned rather than inherited: an api-version without json_schema would silently drop the
      // enum constraint and let an off-list code through.
      response_format: buildDxSchema(candidates),
      max_completion_tokens: MAX_TOKENS,
    });

    const choice = completion.choices?.[0];
    if (choice?.finish_reason === "content_filter") {
      await logPhysicianPhiAudit({
        physicianId,
        eventType: "oscar_billing_dx_no_match",
        ipAddress,
        userAgent,
        metadata: { runId, caseRef, demographicNo, reason: "content_filter" },
      });
      return finish(200, { code: NO_MATCH, confidence: "low", evidence: "", reason: "content_filter" });
    }

    const raw = choice?.message?.content?.trim() || "";
    suggestion = validateDxResponse(raw ? parseJsonValue(raw, "dx model output") : null, candidates);
  } catch (err) {
    // Never fail the sweep on a model problem — the row becomes a manual one.
    console.error(`[${ROUTE}] ${requestId} model call failed:`, err instanceof Error ? err.message : err);
    await logPhysicianPhiAudit({
      physicianId,
      eventType: "oscar_billing_dx_no_match",
      ipAddress,
      userAgent,
      metadata: { runId, caseRef, demographicNo, reason: "model_error" },
    });
    return finish(200, { code: NO_MATCH, confidence: "low", evidence: "", reason: "model_error" });
  }

  // `evidence` is a quote from a clinical note. It goes back to the physician's screen and stays
  // out of the audit row.
  await logPhysicianPhiAudit({
    physicianId,
    eventType: suggestion.code === NO_MATCH ? "oscar_billing_dx_no_match" : "oscar_billing_dx_suggested",
    ipAddress,
    userAgent,
    metadata: {
      runId,
      caseRef,
      demographicNo,
      providerNo,
      candidateCount: candidates.length,
      chosenCode: suggestion.code,
      confidence: suggestion.confidence,
      noteChars: noteText.length,
      physicianResolved: Boolean(physicianId),
    },
  });

  if (!physicianId) {
    console.warn(`[${ROUTE}] ${requestId} no physician mapped to oscar_provider_no=${providerNo}`);
  }

  return finish(200, suggestion);
}
