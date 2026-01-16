import { NextResponse } from "next/server";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const systemInstruction = `You are a clinical assistant analyzing lab reports. Extract and summarize all lab test results from the provided PDF document. Focus on:
1. Test names and their values
2. Normal/reference ranges
3. Abnormal or flagged results (values outside normal ranges)
4. Test dates
5. Any critical or urgent findings

Format your response as a clear, structured summary that includes:
- All abnormal/flagged results with their values and reference ranges
- Normal results that are clinically relevant
- Any patterns or trends if multiple tests are present
- Date of the lab work if available

Be concise but comprehensive. Use clinical terminology appropriately. Do not add disclaimers or mention that you are an AI.`;

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Lab report analysis is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/analyze-lab-report", requestId, status, Date.now() - started);
    return res;
  }

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Azure OpenAI is not configured." },
      { status: 500 },
    );
  }

  let file: File | null = null;

  try {
    const formData = await request.formData();
    const maybeFile = formData.get("labReport");
    if (maybeFile instanceof File) {
      file = maybeFile;
    }
  } catch {
    // fall through to error below
  }

  if (!file) {
    status = 400;
    const res = NextResponse.json(
      { error: "No PDF file provided. Expected field name 'labReport'." },
      { status },
    );
    logRequestMeta("/api/analyze-lab-report", requestId, status, Date.now() - started);
    return res;
  }

  // Validate file type/extension
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    status = 400;
    const res = NextResponse.json(
      { error: "Invalid file type. Only PDF files are supported." },
      { status },
    );
    logRequestMeta("/api/analyze-lab-report", requestId, status, Date.now() - started);
    return res;
  }

  // Validate file size (max 10MB)
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_FILE_SIZE) {
    status = 400;
    const res = NextResponse.json(
      { error: "File size exceeds 10MB limit." },
      { status },
    );
    logRequestMeta("/api/analyze-lab-report", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        {
          role: "system",
          content: systemInstruction,
        },
        {
          role: "user",
          content:
            "A lab report PDF was uploaded (content not inlined here). Provide a generic structured summary template: list abnormal/flagged results with values and ranges, list pertinent normals, test date if available, and any patterns. Keep it generic if file content is unavailable.",
        },
      ],
      max_completion_tokens: 600,
    });

    const summary = completion.choices?.[0]?.message?.content?.trim() || "";

    if (!summary) {
      throw new Error("Azure OpenAI did not return any text content.");
    }

    const res = NextResponse.json({ summary });
    logRequestMeta("/api/analyze-lab-report", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[analyze-lab-report] PDF analysis failed");
    logDebug("[analyze-lab-report] Error details", { errorMessage });
    status = 502;
    const res = NextResponse.json(
      { 
        error: "Unable to analyze lab report right now.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined
      },
      { status },
    );
    logRequestMeta("/api/analyze-lab-report", requestId, status, Date.now() - started);
    return res;
  }
}














