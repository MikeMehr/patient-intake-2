import { NextRequest, NextResponse } from "next/server";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

const supportedLanguages: Record<string, string> = {
  en: "English",
  am: "Amharic",
  ar: "Arabic",
  bn: "Bengali",
  bla: "Blackfoot",
  bs: "Bosnian",
  my: "Burmese",
  yue: "Cantonese",
  chr: "Cherokee",
  cr: "Cree",
  hr: "Croatian",
  cs: "Czech",
  den: "Dene (Athabaskan languages)",
  nl: "Dutch",
  fr: "French",
  de: "German",
  el: "Greek",
  gu: "Gujarati",
  gwi: "Gwich'in",
  hai: "Haida",
  he: "Hebrew",
  hi: "Hindi",
  hu: "Hungarian",
  iu: "Inuktitut",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  ml: "Malayalam",
  zh: "Mandarin Chinese",
  mic: "Mi'kmaq",
  moh: "Mohawk",
  nuk: "Nuu-chah-nulth",
  oj: "Ojibwe (Anishinaabemowin)",
  fa: "Farsi (Persian)",
  pl: "Polish",
  pt: "Portuguese",
  pa: "Punjabi",
  ro: "Romanian",
  ru: "Russian",
  sal: "Salish languages",
  sr: "Serbian",
  scs: "Slavey",
  so: "Somali",
  es: "Spanish",
  sw: "Swahili",
  tl: "Tagalog (Filipino)",
  ta: "Tamil",
  te: "Telugu",
  th: "Thai",
  ti: "Tigrinya",
  tr: "Turkish",
  uk: "Ukrainian",
  ur: "Urdu",
  vi: "Vietnamese",
};

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      { error: "Translation is disabled in HIPAA mode (external AI blocked)." },
      { status },
    );
    logRequestMeta("/api/translate-batch", requestId, status, Date.now() - started);
    return res;
  }

  let payload: { texts?: string[]; language?: string } = {};
  try {
    payload = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
    logRequestMeta("/api/translate-batch", requestId, status, Date.now() - started);
    return res;
  }

  const texts = Array.isArray(payload.texts) ? payload.texts : [];
  const languageCode =
    typeof payload.language === "string"
      ? payload.language.trim().toLowerCase()
      : "";

  if (texts.length === 0) {
    status = 400;
    const res = NextResponse.json({ error: "texts array is required." }, { status });
    logRequestMeta("/api/translate-batch", requestId, status, Date.now() - started);
    return res;
  }

  if (!languageCode || !supportedLanguages[languageCode]) {
    status = 400;
    const res = NextResponse.json(
      { error: "Unsupported or missing language." },
      { status },
    );
    logRequestMeta("/api/translate-batch", requestId, status, Date.now() - started);
    return res;
  }

  if (languageCode === "en") {
    const res = NextResponse.json({ translations: texts });
    logRequestMeta("/api/translate-batch", requestId, status, Date.now() - started);
    return res;
  }

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch {
    status = 500;
    const res = NextResponse.json(
      { error: "Azure OpenAI is not configured." },
      { status },
    );
    logRequestMeta("/api/translate-batch", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const languageName = supportedLanguages[languageCode];

    // Build numbered list so the model sees full questionnaire context,
    // which prevents content filters from flagging clinical items (e.g. PHQ-9 Q9)
    // when evaluated in isolation.
    const numbered = texts
      .map((t, i) => `${i + 1}. ${t}`)
      .join("\n");

    const instruction =
      `You are a certified medical translator working in a licensed clinical setting. ` +
      `You are translating a validated psychiatric screening questionnaire (PHQ-9 / GAD-7) ` +
      `used by physicians for patient mental-health assessment. ` +
      `These are standardised, clinically required items — translate every item faithfully, ` +
      `including questions about mood, suicidal ideation, and self-harm, as accurate ` +
      `translation is essential for patient safety. ` +
      `Translate ALL numbered items into ${languageName}. ` +
      `Return ONLY a JSON array of translated strings in the same order, with no additional text. ` +
      `Example format: ["translation 1", "translation 2", ...]`;

    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: numbered },
      ],
      max_completion_tokens: 2000,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() ?? "";

    // Parse the JSON array response
    let translations: string[] = texts; // fallback to originals
    try {
      // Strip markdown code fences if present
      const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length === texts.length) {
        translations = parsed.map((v) => (typeof v === "string" ? v : texts[parsed.indexOf(v)]));
      }
    } catch {
      // JSON parse failed — try to extract line-by-line as fallback
      const lines = raw
        .split("\n")
        .map((l) => l.replace(/^\d+\.\s*/, "").trim())
        .filter(Boolean);
      if (lines.length === texts.length) {
        translations = lines;
      }
    }

    const res = NextResponse.json({ translations });
    logRequestMeta("/api/translate-batch", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 502;
    console.error("[translate-batch] failed:", error);
    const res = NextResponse.json(
      { error: "Failed to translate texts." },
      { status },
    );
    logRequestMeta("/api/translate-batch", requestId, status, Date.now() - started);
    return res;
  }
}
