/**
 * Specialist extraction for OSCAR's "Add Specialist" page.
 *
 * NOTE THE DIRECTION. Like billing-dx and fax-triage, this route is called *in* by the OSCAR box
 * (mymd/addSpecialist.jsp relays the physician's pasted text server-side) and is authenticated by
 * a shared secret, not by a physician session — there is no cookie on that call path.
 *
 * Unlike its two siblings, what arrives here is NOT clinical text: it is a specialist's public
 * PathwaysBC directory listing (name, specialty, office phone/fax/address), pasted by the
 * physician. No patient is involved, so there is deliberately no logPhysicianPhiAudit call and no
 * HIPAA_MODE gate — do not "fix" that by copying them in from billing-dx.
 *
 * The model only reads the paste. The physician reviews every extracted field on the OSCAR page
 * and the write to OSCAR happens from their own browser session, never from here.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { parseJsonValue } from "@/lib/safe-json";
import {
  buildSpecialistMessages,
  buildSpecialistSchema,
  validateSpecialistResponse,
  emptyExtraction,
  MAX_TEXT_CHARS,
  type SpecialistExtraction,
} from "@/lib/oscar/specialist-extract";

const ROUTE = "/api/emr/oscar/specialist-extract";
const SECRET_HEADER = "x-mymd-specialist-secret";

/** One profile's worth of fields; the physician is waiting on the button. */
const MAX_TOKENS = 600;

const requestSchema = z.object({
  /** The pasted profile text, as-is. */
  text: z.string().min(20).max(MAX_TEXT_CHARS),
  /** OSCAR provider number of the physician pasting, for the request log. */
  providerNo: z.string().min(1).max(12),
});

/** Constant-time compare that tolerates unequal lengths without leaking them. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  const requestId = getRequestId(request.headers);
  const finish = (status: number, body: Record<string, unknown>) => {
    logRequestMeta(ROUTE, requestId, status, Date.now() - started);
    return NextResponse.json(body, { status });
  };

  const expected = process.env.OSCAR_SPECIALIST_BRIDGE_SECRET;
  // Fail closed. With no secret configured this endpoint does not exist as far as callers know.
  if (!expected) return finish(404, { error: "Not found" });
  if (!secretMatches(request.headers.get(SECRET_HEADER), expected)) {
    return finish(401, { error: "Unauthorized" });
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
  const { text, providerNo } = parsed.data;

  let extraction: SpecialistExtraction;
  try {
    const azure = getAzureOpenAIClient();
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: buildSpecialistMessages(text),
      // Pinned rather than inherited: an api-version without json_schema support would silently
      // drop the schema and hand back free text.
      response_format: buildSpecialistSchema(),
      max_completion_tokens: MAX_TOKENS,
    });

    const choice = completion.choices?.[0];
    if (choice?.finish_reason === "content_filter") {
      return finish(200, emptyExtraction("content_filter"));
    }

    const raw = choice?.message?.content?.trim() || "";
    extraction = validateSpecialistResponse(raw ? parseJsonValue(raw, "specialist model output") : null);
  } catch (err) {
    // Never surface a model problem as an error — the page falls back to a blank manual form.
    console.error(`[${ROUTE}] ${requestId} model call failed:`, err instanceof Error ? err.message : err);
    return finish(200, emptyExtraction("model_error"));
  }

  console.log(
    `[${ROUTE}] ${requestId} provider=${providerNo} chars=${text.length} ` +
      `extracted=${extraction.specialists.length} confidence=${extraction.confidence}`,
  );

  return finish(200, extraction);
}
