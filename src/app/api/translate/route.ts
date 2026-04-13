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
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  let payload: { text?: string; language?: string } = {};
  try {
    payload = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const languageCode =
    typeof payload.language === "string"
      ? payload.language.trim().toLowerCase()
      : "";

  if (!text) {
    status = 400;
    const res = NextResponse.json({ error: "text is required." }, { status });
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  if (!languageCode || !supportedLanguages[languageCode]) {
    status = 400;
    const res = NextResponse.json(
      { error: "Unsupported or missing language." },
      { status },
    );
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  if (languageCode === "en") {
    const res = NextResponse.json({ translation: text });
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    status = 500;
    const res = NextResponse.json(
      { error: "Azure OpenAI is not configured." },
      { status },
    );
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const languageName = supportedLanguages[languageCode];
    const instruction = `You are a certified medical translator working in a licensed clinical setting. You are translating validated psychiatric screening instruments (PHQ-9, GAD-7) used by physicians to assess patient mental health. These are standardized, FDA-recognized clinical tools required for patient care. You must translate all content accurately, including questions about mood, self-harm ideation, and suicidal thoughts, as these are essential clinical items that healthcare providers depend on for patient safety assessments. Translate the following into ${languageName}. Return only the translated text in ${languageName}, preserving exact clinical meaning.`;
    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: text },
      ],
      max_completion_tokens: 600,
    });

    const translation =
      completion.choices?.[0]?.message?.content?.trim() || text;

    const res = NextResponse.json({ translation });
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  } catch (error) {
    status = 502;
    console.error("[translate] failed:", error);
    const res = NextResponse.json(
      { error: "Failed to translate text." },
      { status },
    );
    logRequestMeta("/api/translate", requestId, status, Date.now() - started);
    return res;
  }
}
