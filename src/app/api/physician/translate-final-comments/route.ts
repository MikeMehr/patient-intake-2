import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getSession, updateSessionFinalCommentsEnglish } from "@/lib/session-store";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { logDebug } from "@/lib/secure-logger";

async function translatePatientTextToEnglish(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const azure = getAzureOpenAIClient();
  const instruction =
    "You are a medical translation assistant. Translate the patient's message into English. " +
    "Return only the English translation. Preserve medical meaning. Keep it concise.";

  const completion = await azure.client.chat.completions.create({
    model: azure.deployment,
    messages: [
      { role: "system", content: instruction },
      { role: "user", content: trimmed },
    ],
    max_completion_tokens: 600,
  });

  return completion.choices?.[0]?.message?.content?.trim() || trimmed;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Translation is disabled in HIPAA mode (external AI blocked)." },
      { status }
    );
    logRequestMeta("/api/physician/translate-final-comments", requestId, status, Date.now() - started);
    return res;
  }

  const session = await getCurrentSession();
  if (!session) {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required" }, { status });
    logRequestMeta("/api/physician/translate-final-comments", requestId, status, Date.now() - started);
    return res;
  }

  if (session.userType !== "provider") {
    status = 403;
    const res = NextResponse.json({ error: "Only providers can translate sessions" }, { status });
    logRequestMeta("/api/physician/translate-final-comments", requestId, status, Date.now() - started);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
    logRequestMeta("/api/physician/translate-final-comments", requestId, status, Date.now() - started);
    return res;
  }

  const { sessionCode } = (body || {}) as { sessionCode?: string };
  if (!sessionCode || typeof sessionCode !== "string") {
    status = 400;
    const res = NextResponse.json({ error: "sessionCode is required." }, { status });
    logRequestMeta("/api/physician/translate-final-comments", requestId, status, Date.now() - started);
    return res;
  }

  const patientSession = await getSession(sessionCode);
  if (!patientSession) {
    status = 404;
    const res = NextResponse.json({ error: "Session not found or expired" }, { status });
    logRequestMeta("/api/physician/translate-final-comments", requestId, status, Date.now() - started);
    return res;
  }

  if (patientSession.physicianId !== session.userId) {
    status = 403;
    const res = NextResponse.json({ error: "You do not have access to this session" }, { status });
    logRequestMeta("/api/physician/translate-final-comments", requestId, status, Date.now() - started);
    return res;
  }

  const history = patientSession.history;
  const original = history?.patientFinalQuestionsComments?.trim() || "";
  if (!original) {
    status = 400;
    const res = NextResponse.json({ error: "No final comments to translate." }, { status });
    logRequestMeta("/api/physician/translate-final-comments", requestId, status, Date.now() - started);
    return res;
  }

  const existing = history?.patientFinalQuestionsCommentsEnglish?.trim() || "";
  if (existing) {
    const res = NextResponse.json({ translation: existing });
    logRequestMeta("/api/physician/translate-final-comments", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const translated = await translatePatientTextToEnglish(original);
    if (!translated.trim()) {
      throw new Error("Empty translation returned.");
    }

    // Best-effort persist. Even if persist fails, return the translation for this view.
    try {
      await updateSessionFinalCommentsEnglish(sessionCode, translated);
    } catch (persistErr) {
      logDebug("[translate-final-comments] Failed to persist translation", {
        errorMessage: persistErr instanceof Error ? persistErr.message : String(persistErr),
      });
    }

    const res = NextResponse.json({ translation: translated.trim() });
    logRequestMeta("/api/physician/translate-final-comments", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    status = 502;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[translate-final-comments] failed:", errorMessage);
    const res = NextResponse.json(
      {
        error: "Failed to translate final comments.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status }
    );
    logRequestMeta("/api/physician/translate-final-comments", requestId, status, Date.now() - started);
    return res;
  }
}

