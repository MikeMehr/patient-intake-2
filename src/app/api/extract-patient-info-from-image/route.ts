import { NextRequest, NextResponse } from "next/server";
import { getAzureVisionClient } from "@/lib/azure-openai";
import { getCurrentSession } from "@/lib/auth";

const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (session.userType !== "provider") {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const imageFile = formData.get("image");
  if (!(imageFile instanceof File)) {
    return NextResponse.json({ error: "No image provided" }, { status: 400 });
  }

  if (!imageFile.type.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image" }, { status: 400 });
  }

  if (imageFile.size > MAX_SIZE) {
    return NextResponse.json({ error: "Image must be under 10 MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await imageFile.arrayBuffer());
  const base64 = buffer.toString("base64");
  const mimeType = imageFile.type;

  const { client, deployment } = getAzureVisionClient();

  const response = await client.chat.completions.create({
    model: deployment,
    messages: [
      {
        role: "system",
        content:
          "You are extracting patient registration information from a photo of a health card, ID, or medical document. Return ONLY a JSON object with these exact fields: patientName (full name as a string), patientEmail (email address if visible, else empty string), patientDob (date of birth in YYYY-MM-DD format if visible, else empty string). Extract only what is clearly visible. Do not guess or infer.",
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
          {
            type: "text",
            text: "Extract patient name, email, and date of birth from this image.",
          },
        ],
      },
    ],
    max_tokens: 200,
  });

  const raw = response.choices[0]?.message?.content ?? "";

  let extracted: { patientName?: string; patientEmail?: string; patientDob?: string } = {};
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      extracted = JSON.parse(jsonMatch[0]);
    }
  } catch {
    return NextResponse.json({ error: "Could not parse extracted info" }, { status: 500 });
  }

  return NextResponse.json({
    patientName: typeof extracted.patientName === "string" ? extracted.patientName.trim() : "",
    patientEmail: typeof extracted.patientEmail === "string" ? extracted.patientEmail.trim() : "",
    patientDob: typeof extracted.patientDob === "string" ? extracted.patientDob.trim() : "",
  });
}
