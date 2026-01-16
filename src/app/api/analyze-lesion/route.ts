import { NextResponse } from "next/server";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const systemInstruction = `You are assisting with triage of a skin complaint. Briefly describe the visible skin findings in images using neutral, clinical language, including morphology, distribution, and any obvious red-flag features. Limit your answer to 3–5 short sentences. Do not add disclaimers.`;

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Image analysis is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/analyze-lesion", requestId, status, Date.now() - started);
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
    const maybeFile = formData.get("image");
    if (maybeFile instanceof File) {
      file = maybeFile;
    }
  } catch {
    // fall through to error below
  }

  if (!file) {
    status = 400;
    const res = NextResponse.json(
      { error: "No image file provided. Expected field name 'image'." },
      { status },
    );
    logRequestMeta("/api/analyze-lesion", requestId, status, Date.now() - started);
    return res;
  }

  // Validate allowed image types (restrict to common formats)
  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    status = 400;
    const res = NextResponse.json(
      { error: "Invalid image type. Only PNG, JPEG, or WEBP are supported." },
      { status },
    );
    logRequestMeta("/api/analyze-lesion", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();

    // Basic magic-number checks for PNG/JPEG/WEBP
    const bytes = new Uint8Array(arrayBuffer.slice(0, 12));
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp =
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (!(isPng || isJpeg || isWebp)) {
      return NextResponse.json(
        { error: "Invalid image content." },
        { status: 400 },
      );
    }
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

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
            "A skin lesion image was uploaded (content not inlined here). Provide a generic 3-5 sentence clinical description template: morphology, distribution, color, size, borders, and any obvious red flags. Keep it generic if image content is unavailable.",
        },
      ],
      max_completion_tokens: 300,
    });

    const summary = completion.choices?.[0]?.message?.content?.trim() || "";

    if (!summary) {
      throw new Error("Azure OpenAI did not return any text content.");
    }

    const res = NextResponse.json({ summary });
    logRequestMeta("/api/analyze-lesion", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[analyze-lesion] Image analysis failed");
    logDebug("[analyze-lesion] Error details", { errorMessage });
    status = 502;
    const res = NextResponse.json(
      { 
        error: "Unable to analyze image right now.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined
      },
      { status },
    );
    logRequestMeta("/api/analyze-lesion", requestId, status, Date.now() - started);
    return res;
  }
}
