import { NextRequest, NextResponse } from "next/server";
import { getAzureVisionClient } from "@/lib/azure-openai";
import { logDebug } from "@/lib/secure-logger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let status = 200;
  try {
    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      status = 400;
      return NextResponse.json({ error: "Image file is required." }, { status });
    }

    // Practical limit to keep data URLs manageable for vision; allow up to 6MB
    const MAX_BYTES = 6 * 1024 * 1024; // 6MB
    if (file.size > MAX_BYTES) {
      status = 413;
      return NextResponse.json(
        { error: "File too large for analysis. Please upload an image/PDF under 6MB." },
        { status },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer.slice(0, 12));
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp =
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    const isPdf =
      bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF

    if (!(isPng || isJpeg || isWebp || isPdf)) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload an image or PDF." },
        { status: 400 },
      );
    }

    const base64Image = Buffer.from(arrayBuffer).toString("base64");
    const mime = file.type && file.type.length > 0 ? file.type : isPdf ? "application/pdf" : "image/png";
    const dataUrl = `data:${mime};base64,${base64Image}`;

    const azure = getAzureVisionClient();

    const systemInstruction = `
You extract structured clinical data from a photo or PDF of a medication list and past medical history (PMH).
Return concise, structured text suitable for downstream clinical use.
Rules:
- Perform best-effort OCR. Include any partially readable text rather than saying "Unclear".
- Only mark an individual item "Unclear" if that specific line is truly illegible; do not mark the entire list unclear if some lines are readable.
- Preserve partial fields if only some parts are legible (e.g., keep the drug name even if dose is unclear).
- Medications: list each medication with name, strength, dose, frequency if present. Include OTC/supplements if shown.
- PMH: list pertinent diagnoses/problems separately.
- Do NOT fabricate missing data.
- Do NOT return "None identified" or empty lists if any text is readable; include partial tokens (e.g., partial drug names) instead.
- Output in two sections exactly:
  Medications:
    - name – strength – dose/frequency (bullets)
  Pertinent PMH:
    - problem/diagnosis (bullets)
`.trim();

    const userPrompt = `
An image/PDF is attached. Extract medications and PMH as instructed.
- Use best-effort transcription from the attached image/PDF.
- Include partial tokens; only mark a specific line as "Unclear" if truly illegible.
- Do not mark all items unclear if any text is readable.
`.trim();

    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: systemInstruction },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_completion_tokens: 400,
      temperature: 0,
    });

    const summary = completion.choices?.[0]?.message?.content?.trim();
    if (!summary) {
      throw new Error("Azure OpenAI did not return any text content.");
    }

    return NextResponse.json({ summary });
  } catch (error: unknown) {
    status = 500;
    const message = error instanceof Error ? error.message : String(error);
    // Avoid logging provider response payloads that could contain PHI echoes.
    console.error("[analyze-med-pmh] Error analyzing image", {
      statusCode: (error as any)?.response?.status,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    logDebug("[analyze-med-pmh] Error analyzing image", {
      error: message,
      statusCode: (error as any)?.response?.status,
    });
    return NextResponse.json(
      {
        error: "Failed to analyze medication/PMH photo.",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status },
    );
  }
}

