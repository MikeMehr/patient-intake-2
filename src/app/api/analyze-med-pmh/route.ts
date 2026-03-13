import { NextRequest, NextResponse } from "next/server";
import { getAzureVisionClient } from "@/lib/azure-openai";
import { logDebug } from "@/lib/secure-logger";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const heicConvert = require("heic-convert") as typeof import("heic-convert");

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    return NextResponse.json(
      { error: "Medication/PMH analysis is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
  }

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

    const mode = (formData.get("mode") as string | null) ?? "both"; // "pmh" | "medications" | "both"

    let arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer.slice(0, 12));
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp =
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    const isPdf =
      bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
    // HEIC: bytes 4-7 are "ftyp", bytes 8-11 are a HEIC brand
    const isFtyp = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    const heicBrands = ["heic", "heix", "mif1", "msf1", "hevc", "hevx"];
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    const isHeic = isFtyp && heicBrands.includes(brand);

    if (!(isPng || isJpeg || isWebp || isPdf || isHeic)) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload an image (JPEG, PNG, WebP, HEIC) or PDF." },
        { status: 400 },
      );
    }

    let mime = "image/jpeg";
    if (isPng) mime = "image/png";
    else if (isWebp) mime = "image/webp";
    else if (isPdf) mime = "application/pdf";

    // Convert HEIC to JPEG for Azure Vision compatibility
    if (isHeic) {
      const jpegUint8 = await heicConvert({
        buffer: Buffer.from(arrayBuffer),
        format: "JPEG",
        quality: 0.92,
      });
      arrayBuffer = Buffer.from(jpegUint8).buffer as ArrayBuffer;
      mime = "image/jpeg";
    } else if (file.type && file.type.length > 0) {
      mime = file.type;
    }

    const base64Image = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `data:${mime};base64,${base64Image}`;

    const azure = getAzureVisionClient();

    let systemInstruction: string;
    let userPrompt: string;

    if (mode === "pmh") {
      systemInstruction = `
You are a clinical OCR assistant. Extract the list of medical diagnoses and conditions from the attached image or PDF.

OUTPUT FORMAT — respond with exactly these two sections, no other text:

Medications:
- None

Pertinent PMH:
- [diagnosis or condition]

RULES:
- Replace the bracketed placeholder with EACH diagnosis/condition you read from the image, one per line.
- Everything in the image is a medical history item — list it under Pertinent PMH.
- Perform best-effort OCR; include partially readable text rather than skipping it.
- Only mark a line "Unclear" if it is truly illegible.
- Do NOT fabricate data.
`.trim();
      userPrompt = `List every diagnosis and medical condition visible in the attached image under Pertinent PMH.`;
    } else if (mode === "medications") {
      systemInstruction = `
You are a clinical OCR assistant. Extract the list of medications from the attached image or PDF.

OUTPUT FORMAT — respond with exactly these two sections, no other text:

Medications:
- [drug name] [strength] [dose/frequency]

Pertinent PMH:
- None

RULES:
- Replace the bracketed placeholder with EACH medication you read from the image, one per line. Include name, strength, and dose/frequency when present.
- Perform best-effort OCR; include partially readable text rather than skipping it.
- Only mark a line "Unclear" if it is truly illegible.
- Do NOT fabricate data.
`.trim();
      userPrompt = `List every medication visible in the attached image under Medications.`;
    } else {
      systemInstruction = `
You are a clinical OCR assistant. Extract medications and past medical history (PMH) from the attached image or PDF.

CLASSIFICATION:
- Medications: drug/medication names with strength and dose (e.g., metformin 500 mg BID, lisinopril 10 mg daily).
- Pertinent PMH: diagnoses and conditions (e.g., HTN, DM2, asthma, CAD, COPD, hypothyroidism).

OUTPUT FORMAT — respond with exactly these two sections, no other text:

Medications:
- [drug name] [strength] [dose/frequency]

Pertinent PMH:
- [diagnosis or condition]

RULES:
- Replace the bracketed placeholders with the ACTUAL content you read from the image.
- If no medications are visible, write "- None" under Medications.
- If no PMH items are visible, write "- None" under Pertinent PMH.
- Perform best-effort OCR; include partially readable text rather than skipping it.
- Only mark a line "Unclear" if it is truly illegible.
- Do NOT fabricate data.
`.trim();
      userPrompt = `Extract all medications and medical history items from the attached image.`;
    }

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

