import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const MAX_IMAGE_BASE64_LENGTH = 7_000_000;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const systemPrompt = `You are a clinical wound measurement assistant. The image contains a wound with a ruler for scale.
Using the ruler as reference, estimate wound dimensions and describe wound characteristics.
Return ONLY valid JSON with no markdown or code fences. Use this exact schema:
{
  "length": "<number as string, e.g. '3.2'>",
  "width": "<number as string, e.g. '1.8'>",
  "surfaceArea": "<length × width formatted as 'X.XX sq cm'>",
  "borders": "<e.g. 'irregular' or 'regular; no undermining'>",
  "woundBase": "<precise tissue description, e.g. 'fibrinous slough with underlying granulation tissue'>",
  "woundBaseComposition": "<tissue percentage breakdown required for Medicare, e.g. '60% granulation, 30% fibrinous slough, 10% necrotic eschar'>",
  "periwound": "<periwound skin findings, e.g. 'skin thin, fragile, no maceration'>",
  "drainageType": "<e.g. 'minimal, serosanguinous' or 'moderate, purulent'>",
  "signsOfInfection": "<e.g. 'none' or 'erythema, warmth, induration'>",
  "stage": "<pressure ulcer stage if applicable, e.g. 'unstageable' or 'N/A'>",
  "notes": "<brief overall wound appearance description>"
}
Use precise clinical terminology. Do not use vague terms. If the ruler is not clearly visible, provide best estimates based on visible anatomical context.`;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "AI actions are disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/physician/transcription/analyze-wound", requestId, status, Date.now() - started);
    return res;
  }

  const session = await getCurrentSession();
  if (!session || session.userType !== "provider") {
    status = 401;
    const res = NextResponse.json({ error: "Authentication required." }, { status });
    logRequestMeta("/api/physician/transcription/analyze-wound", requestId, status, Date.now() - started);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
    logRequestMeta("/api/physician/transcription/analyze-wound", requestId, status, Date.now() - started);
    return res;
  }

  const { imageBase64, mimeType } = (body || {}) as { imageBase64?: string; mimeType?: string };

  if (!imageBase64 || typeof imageBase64 !== "string") {
    status = 400;
    const res = NextResponse.json({ error: "imageBase64 is required." }, { status });
    logRequestMeta("/api/physician/transcription/analyze-wound", requestId, status, Date.now() - started);
    return res;
  }

  if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
    status = 400;
    const res = NextResponse.json({ error: "Image is too large (max 5 MB)." }, { status });
    logRequestMeta("/api/physician/transcription/analyze-wound", requestId, status, Date.now() - started);
    return res;
  }

  const resolvedMime = mimeType && ALLOWED_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : "image/jpeg";

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    status = 500;
    const res = NextResponse.json(
      { error: (err as Error).message || "Azure OpenAI is not configured." },
      { status },
    );
    logRequestMeta("/api/physician/transcription/analyze-wound", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${resolvedMime};base64,${imageBase64}`, detail: "high" },
            },
            { type: "text", text: "Analyze this wound image with ruler and return the JSON measurement data." },
          ],
        },
      ],
      max_completion_tokens: 600,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";

    // Strip markdown fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    try {
      const parsed = JSON.parse(jsonStr);
      const res = NextResponse.json({
        length: parsed.length ?? "—",
        width: parsed.width ?? "—",
        surfaceArea: parsed.surfaceArea ?? "—",
        borders: parsed.borders ?? "—",
        woundBase: parsed.woundBase ?? "—",
        woundBaseComposition: parsed.woundBaseComposition ?? "—",
        periwound: parsed.periwound ?? "—",
        drainageType: parsed.drainageType ?? "—",
        signsOfInfection: parsed.signsOfInfection ?? "—",
        stage: parsed.stage ?? "—",
        notes: parsed.notes ?? "",
      });
      logRequestMeta("/api/physician/transcription/analyze-wound", requestId, status, Date.now() - started);
      return res;
    } catch {
      // JSON parse failed — return safe defaults with raw text as notes
      const res = NextResponse.json({
        length: "—",
        width: "—",
        surfaceArea: "—",
        borders: "—",
        woundBase: "—",
        woundBaseComposition: "—",
        periwound: "—",
        drainageType: "—",
        signsOfInfection: "—",
        stage: "—",
        notes: raw,
      });
      logRequestMeta("/api/physician/transcription/analyze-wound", requestId, status, Date.now() - started);
      return res;
    }
  } catch (err) {
    status = 500;
    console.error("[analyze-wound] AI call failed:", err);
    const res = NextResponse.json({ error: "Wound analysis failed." }, { status });
    logRequestMeta("/api/physician/transcription/analyze-wound", requestId, status, Date.now() - started);
    return res;
  }
}
