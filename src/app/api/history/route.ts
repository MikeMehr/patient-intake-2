import {
  historyRequestSchema,
  historyResponseSchema,
} from "@/lib/history-schema";
import { mockHistory } from "@/lib/mock-history";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

const systemInstruction = `You are a meticulous clinical intake assistant. Collect relevant history of present illness data from short prompts. Respond ONLY in JSON with keys: positives (array of strings), negatives (array of strings), physicalFindings (array of strings, optional), summary (string), investigations (array of strings), assessment (string), and plan (array of strings). Summaries must remain one paragraph, concise, and professional. Include physicalFindings only if virtual physical exam findings were gathered. Do not mention that you are an AI or provide disclaimers.`;

const shouldMock = () =>
  process.env.MOCK_AI === "true" || process.env.NODE_ENV === "test";

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  let payload: Record<string, unknown>;

  try {
    payload = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json(
      { error: "Invalid JSON body." },
      { status },
    );
    logRequestMeta("/api/history", requestId, status, Date.now() - started);
    return res;
  }

  const parsed = historyRequestSchema.safeParse(payload);
  if (!parsed.success) {
    status = 400;
    const res = NextResponse.json(
      { error: "Invalid chief complaint.", details: parsed.error.format() },
      { status },
    );
    logRequestMeta("/api/history", requestId, status, Date.now() - started);
    return res;
  }

  if (shouldMock()) {
    const res = NextResponse.json({
      ...mockHistory,
      summary: `${mockHistory.summary} Chief complaint: "${parsed.data.chiefComplaint}".`,
    });
    logRequestMeta("/api/history", requestId, status, Date.now() - started);
    return res;
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    status = 500;
    const res = NextResponse.json(
      { error: "GOOGLE_AI_API_KEY is not configured." },
      { status },
    );
    logRequestMeta("/api/history", requestId, status, Date.now() - started);
    return res;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ 
    model, 
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
    systemInstruction: systemInstruction,
  });

  try {
    const prompt = `Chief complaint: ${parsed.data.chiefComplaint}\n\nProvide pertinent positives and negatives addressing onset, duration, associated symptoms, modifying factors, and critical red flags. Include suggested investigations (if any), a concise assessment, and a clear plan.`;

    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    const textPayload = response.text().trim();

    const history = parseHistory(textPayload);

    const res = NextResponse.json(history);
    logRequestMeta("/api/history", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[history-route] Generation failed");
    logDebug("[history-route] Error details", { errorMessage });
    status = 502;
    const res = NextResponse.json(
      {
        error: "Unable to generate history at this time.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined
      },
      { status },
    );
    logRequestMeta("/api/history", requestId, status, Date.now() - started);
    return res;
  }
}

function parseHistory(payload: string) {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(payload);
  } catch {
    throw new Error("Google Gemini returned malformed JSON.");
  }

  const parsed = historyResponseSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new Error("Google Gemini returned an invalid payload.");
  }

  return parsed.data;
}
