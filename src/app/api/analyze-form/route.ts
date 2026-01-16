import { NextResponse } from "next/server";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const systemInstruction = `You are a clinical assistant analyzing forms (school forms, work forms, MVA insurance forms, etc.) that need to be completed for patients. Extract and summarize all information from the provided PDF form document. Focus on:
1. Form title and purpose
2. Form type/context (school form, work form, MVA insurance form, etc.)
3. All questions/fields that need to be filled out
4. Required information for each field
5. Any specific medical information needed
6. Form structure and sections

Format your response as a clear, structured summary that includes:
- Form title and purpose
- Form type/context
- List of all questions/fields that need patient information
- Required information for each field
- Any special instructions or requirements
- Medical information needed (if applicable)

Be concise but comprehensive. Use clear language. Do not add disclaimers or mention that you are an AI.`;

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Document analysis is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/analyze-form", requestId, status, Date.now() - started);
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
    const maybeFile = formData.get("form");
    if (maybeFile instanceof File) {
      file = maybeFile;
    }
  } catch {
    // fall through to error below
  }

  if (!file) {
    status = 400;
    const res = NextResponse.json(
      { error: "No PDF file provided. Expected field name 'form'." },
      { status },
    );
    logRequestMeta("/api/analyze-form", requestId, status, Date.now() - started);
    return res;
  }

  // Validate file type/extension
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    status = 400;
    const res = NextResponse.json(
      { error: "Invalid file type. Only PDF files are supported." },
      { status },
    );
    logRequestMeta("/api/analyze-form", requestId, status, Date.now() - started);
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
    logRequestMeta("/api/analyze-form", requestId, status, Date.now() - started);
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
            "A PDF form was uploaded (content not inlined here). Provide a concise template: form title/purpose, type/context, list of fields and required info, special instructions. Keep it generic if file content is unavailable.",
        },
      ],
      max_completion_tokens: 600,
    });

    const summary = completion.choices?.[0]?.message?.content?.trim() || "";

    if (!summary) {
      throw new Error("Azure OpenAI did not return any text content.");
    }

    const res = NextResponse.json({ summary });
    logRequestMeta("/api/analyze-form", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[analyze-form] PDF analysis failed");
    logDebug("[analyze-form] Error details", { errorMessage });
    status = 502;
    const res = NextResponse.json(
      { 
        error: "Unable to analyze form right now.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined
      },
      { status },
    );
    logRequestMeta("/api/analyze-form", requestId, status, Date.now() - started);
    return res;
  }
}













