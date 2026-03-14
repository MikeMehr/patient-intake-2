/**
 * POST /api/generate-form-answers
 * Uses the session's form summary (question list) and interview transcript
 * to produce a structured Q&A fill-out of the uploaded form.
 * Results are cached in the session's history JSONB.
 */

import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getSession, updateSessionFormAnswers } from "@/lib/session-store";
import { canAccessSessionInScope, loadSessionAccessScope } from "@/lib/session-access";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const SYSTEM_INSTRUCTION = `You are a clinical documentation assistant. You are given:
1. A list of form questions that need to be answered for a patient
2. A patient interview transcript

Your task: for each question, extract the patient's answer from the transcript.

Rules:
- Answer each question using only information the patient provided in the transcript
- If a question was not addressed during the interview, write exactly: "Not discussed during interview"
- Keep answers concise but complete — preserve all relevant clinical details mentioned
- Do not invent or infer information beyond what was stated
- Return ONLY a JSON array — no commentary, no markdown fences

Output format:
[
  { "question": "What is the date of your injury?", "answer": "March 10, 2026" },
  { "question": "Describe the nature of your disability.", "answer": "Not discussed during interview" }
]`;

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  // Require authenticated physician session
  const authSession = await getCurrentSession();
  if (!authSession) {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required" }, { status });
    logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
    return res;
  }
  if ((authSession as { userType?: string }).userType !== "provider") {
    status = 403;
    const res = NextResponse.json({ error: "Only providers can generate form answers" }, { status });
    logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
    return res;
  }

  let sessionCode: string | null = null;
  try {
    const body = await request.json();
    sessionCode = typeof body?.sessionCode === "string" ? body.sessionCode.trim() : null;
  } catch {
    // fall through to error below
  }

  if (!sessionCode) {
    status = 400;
    const res = NextResponse.json({ error: "sessionCode is required" }, { status });
    logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
    return res;
  }

  // Verify physician can access this session
  const scope = await loadSessionAccessScope(sessionCode);
  if (!scope) {
    status = 404;
    const res = NextResponse.json({ error: "Session not found" }, { status });
    logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
    return res;
  }
  if (!canAccessSessionInScope({ viewer: authSession, resource: scope })) {
    status = 403;
    const res = NextResponse.json({ error: "Access denied" }, { status });
    logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
    return res;
  }

  const session = await getSession(sessionCode);
  if (!session) {
    status = 404;
    const res = NextResponse.json({ error: "Session not found" }, { status });
    logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
    return res;
  }

  // Return cached answers if already generated
  const cached = (session.history as any)?.formAnswers;
  if (Array.isArray(cached) && cached.length > 0) {
    const res = NextResponse.json({ formAnswers: cached, cached: true });
    logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
    return res;
  }

  const formSummary = (session.history as any)?.formSummary as string | undefined;
  if (!formSummary?.trim()) {
    status = 400;
    const res = NextResponse.json({ error: "No form questions found for this session" }, { status });
    logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
    return res;
  }

  // Build transcript text from the stored interview Q&A
  const transcript = session.transcript || [];
  const transcriptText =
    transcript.length > 0
      ? transcript
          .map((msg: { role: string; content: string }) =>
            `${msg.role === "assistant" ? "Interviewer" : "Patient"}: ${msg.content}`,
          )
          .join("\n")
      : "No interview transcript available.";

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    status = 500;
    const res = NextResponse.json(
      { error: (err as Error).message || "Azure OpenAI is not configured." },
      { status },
    );
    logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const userMessage =
      `FORM QUESTIONS:\n${formSummary}\n\n` +
      `INTERVIEW TRANSCRIPT:\n${transcriptText.slice(0, 50000)}`;

    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION },
        { role: "user", content: userMessage },
      ],
      max_completion_tokens: 2000,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "[]";

    let formAnswers: { question: string; answer: string }[] = [];
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        formAnswers = parsed.filter(
          (item): item is { question: string; answer: string } =>
            item &&
            typeof item.question === "string" &&
            typeof item.answer === "string",
        );
      }
    } catch {
      logDebug("[generate-form-answers] Failed to parse OpenAI JSON", { raw: raw.slice(0, 200) });
      status = 502;
      const res = NextResponse.json({ error: "Unable to parse form answers from AI response." }, { status });
      logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
      return res;
    }

    // Persist answers to DB so subsequent views use the cached result
    try {
      await updateSessionFormAnswers(sessionCode, formAnswers);
    } catch (dbErr) {
      logDebug("[generate-form-answers] Failed to cache form answers", {
        errorMessage: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
      // Non-fatal — return answers even if caching fails
    }

    const res = NextResponse.json({ formAnswers });
    logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[generate-form-answers] Failed");
    logDebug("[generate-form-answers] Error details", { errorMessage });
    status = 502;
    const res = NextResponse.json(
      {
        error: "Unable to generate form answers right now.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status },
    );
    logRequestMeta("/api/generate-form-answers", requestId, status, Date.now() - started);
    return res;
  }
}
