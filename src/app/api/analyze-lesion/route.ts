import OpenAI from "openai";
import { NextResponse } from "next/server";

const visionModel = process.env.OPENAI_VISION_MODEL ?? "gpt-4o";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
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
    return NextResponse.json(
      { error: "No image file provided. Expected field name 'image'." },
      { status: 400 },
    );
  }

  const openai = new OpenAI({ apiKey });

  try {
    const arrayBuffer = await file.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

    const response = await openai.chat.completions.create({
      model: visionModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "You are assisting with triage of a skin complaint. " +
                "Briefly describe the visible skin findings in this image using neutral, clinical language, " +
                "including morphology, distribution, and any obvious red-flag features. " +
                "Limit your answer to 3–5 short sentences. Do not add disclaimers.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${file.type};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    const summary = response.choices[0]?.message?.content?.trim();

    if (!summary) {
      throw new Error("OpenAI vision did not return any text content.");
    }

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("[analyze-lesion]", error);
    return NextResponse.json(
      { 
        error: "Unable to analyze image right now.",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 502 },
    );
  }
}


