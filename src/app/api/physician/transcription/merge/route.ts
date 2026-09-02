import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getEffectivePhysicianId } from "@/lib/auth-helpers";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { mergeSoapCasesRequestSchema, soapDraftSchema } from "@/lib/transcription-schema";
import { escapeRawNewlinesInJsonStrings, parseJsonValue } from "@/lib/safe-json";
import { formatStyleRulesAppendix, listStyleRuleTexts } from "@/lib/ai-style-rules";

const SYSTEM_PROMPT = `You are a clinical documentation assistant.
You will receive several SOAP notes, each covering a different clinical problem from the SAME patient and the SAME visit. Merge them into ONE coherent SOAP note with zero redundancy.
Return valid JSON only: a single object with keys subjective, objective, assessment, plan.
Merge rules:
- Every clinical fact appears EXACTLY ONCE in the merged note, in the single most appropriate place. Never repeat a lab value, medication, history item, diagnosis, or plan action under multiple problems or in multiple sections. If the same fact appears in several source notes, keep it once and drop the copies.
- "subjective": group the history by problem, prefixing each problem's content with its label and a colon (e.g. "Elevated Liver Enzymes: ..."). Facts relevant to several problems (family history, medication history, prior episodes) are stated once, under the problem they matter most to.
- "objective": one consolidated list of exam findings, vitals, and lab results for the whole visit — no problem labels, each value stated once. Leave it an empty string if nothing was examined or measured.
- "assessment": one labeled entry per problem, stating the working diagnosis (and differential only when genuinely useful). No empty entries and no restating of subjective history.
- "plan": one labeled entry per problem with its actions in telegraphic style separated by semicolons; an action that serves several problems (e.g. a recheck panel) is listed once under the most relevant problem.
- Preserve the wording, detail level, and telegraphic style of the source notes. Do not invent new clinical content and do not drop any clinically significant detail — only reorganize and deduplicate.
CRITICAL JSON RULE: Every field value must be plain text on a single line. Do NOT use bullet characters or literal line breaks (\\n) inside any string value — literal newlines inside JSON strings produce invalid JSON and will cause an error. Separate sentences with a single space; the app renders each sentence as its own bullet automatically.
Do not include markdown, code fences, or extra keys.
IMPORTANT: Always write the merged note entirely in English.`;

function buildUserPrompt(cases: Array<{ label: string; draft: { subjective: string; objective: string; assessment: string; plan: string } }>): string {
  return cases
    .map((c, i) => {
      const label = c.label.trim() || `Case ${i + 1}`;
      return [
        `--- SOAP note ${i + 1}: ${label} ---`,
        `Subjective: ${c.draft.subjective}`,
        `Objective: ${c.draft.objective || "(none documented)"}`,
        `Assessment: ${c.draft.assessment}`,
        `Plan: ${c.draft.plan || "(none documented)"}`,
      ].join("\n");
    })
    .join("\n\n");
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "AI merge is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/physician/transcription/merge", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const auth = await getCurrentSession();
    if (!auth) {
      status = 401;
      const res = NextResponse.json({ error: "Authentication required." }, { status });
      logRequestMeta("/api/physician/transcription/merge", requestId, status, Date.now() - started);
      return res;
    }
    if (auth.userType !== "provider") {
      status = 403;
      const res = NextResponse.json({ error: "Provider access required." }, { status });
      logRequestMeta("/api/physician/transcription/merge", requestId, status, Date.now() - started);
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = mergeSoapCasesRequestSchema.safeParse(body);
    if (!parsed.success) {
      status = 400;
      const res = NextResponse.json({ error: "Invalid payload.", details: parsed.error.format() }, { status });
      logRequestMeta("/api/physician/transcription/merge", requestId, status, Date.now() - started);
      return res;
    }

    const physicianId = getEffectivePhysicianId(auth);
    const styleRules = await listStyleRuleTexts(physicianId, "soap");
    const styleAppendix = styleRules.length
      ? "\n\n" + formatStyleRulesAppendix(styleRules, "SOAP notes")
      : "";

    const azure = getAzureOpenAIClient();
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: SYSTEM_PROMPT + styleAppendix },
        { role: "user", content: buildUserPrompt(parsed.data.cases) },
      ],
      max_completion_tokens: 3000,
    });

    const rawContent = completion.choices?.[0]?.message?.content?.trim() || "";
    const stripped = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const payload = escapeRawNewlinesInJsonStrings(stripped);
    let draft: { subjective: string; objective: string; assessment: string; plan: string };
    try {
      const rawParsed = parseJsonValue(payload, "Merged SOAP model output");
      const result = soapDraftSchema.safeParse(rawParsed);
      if (!result.success) throw new Error("Merged SOAP has invalid schema.");
      draft = result.data;
    } catch {
      status = 422;
      const res = NextResponse.json({ error: "AI merge produced an invalid note. Please try again." }, { status });
      logRequestMeta("/api/physician/transcription/merge", requestId, status, Date.now() - started);
      return res;
    }

    const res = NextResponse.json({ draft });
    logRequestMeta("/api/physician/transcription/merge", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 500;
    const apiStatus = error instanceof Error && "status" in error ? (error as { status: number }).status : null;
    if (apiStatus === 429) {
      status = 429;
      console.error("[physician/transcription/merge] Azure OpenAI rate limit:", error);
      const res = NextResponse.json({ error: "AI service is busy. Please try again in a moment." }, { status });
      logRequestMeta("/api/physician/transcription/merge", requestId, status, Date.now() - started);
      return res;
    }
    console.error("[physician/transcription/merge] failed:", error);
    const res = NextResponse.json({ error: "Failed to merge SOAP notes." }, { status });
    logRequestMeta("/api/physician/transcription/merge", requestId, status, Date.now() - started);
    return res;
  }
}
