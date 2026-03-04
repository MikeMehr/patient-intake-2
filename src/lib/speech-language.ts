export const languageOptions = [
  { value: "en", label: "English (default)" },
  { value: "am", label: "Amharic" },
  { value: "ar", label: "Arabic" },
  { value: "bn", label: "Bengali" },
  { value: "bs", label: "Bosnian" },
  { value: "my", label: "Burmese" },
  { value: "yue", label: "Cantonese" },
  { value: "chr", label: "Cherokee" },
  { value: "cr", label: "Cree" },
  { value: "hr", label: "Croatian" },
  { value: "cs", label: "Czech" },
  { value: "nl", label: "Dutch" },
  { value: "es", label: "Spanish" },
  { value: "fa", label: "Farsi (Persian)" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "el", label: "Greek" },
  { value: "gu", label: "Gujarati" },
  { value: "he", label: "Hebrew" },
  { value: "hi", label: "Hindi" },
  { value: "hu", label: "Hungarian" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "pt", label: "Portuguese" },
  { value: "zh", label: "Chinese (Simplified)" },
] as const;

export const supportedLanguageNames: Record<string, string> =
  languageOptions.reduce<Record<string, string>>((acc, item) => {
    acc[item.value] = item.label;
    return acc;
  }, {});

export function getSpeechLocale(code: string): string {
  const normalized = (code || "en").trim().toLowerCase();
  switch (normalized) {
    case "en":
      return "en-US";
    case "am":
      return "am-ET";
    case "bn":
      return "bn-IN";
    case "bs":
      return "bs-BA";
    case "my":
      return "my-MM";
    case "yue":
      return "yue-HK";
    case "hr":
      return "hr-HR";
    case "cs":
      return "cs-CZ";
    case "nl":
      return "nl-NL";
    case "fa":
      return "fa-IR";
    case "el":
      return "el-GR";
    case "gu":
      return "gu-IN";
    case "he":
      return "he-IL";
    case "hu":
      return "hu-HU";
    case "zh":
      return "zh-CN";
    case "pt":
      return "pt-PT";
    case "es":
      return "es-ES";
    case "fr":
      return "fr-FR";
    case "de":
      return "de-DE";
    case "it":
      return "it-IT";
    case "ja":
      return "ja-JP";
    case "ko":
      return "ko-KR";
    case "ar":
      return "ar-SA";
    case "hi":
      return "hi-IN";
    default:
      return "en-US";
  }
}

export function normalizeLanguageCode(code: string | null | undefined): string {
  const normalized = (code || "en").trim().toLowerCase();
  if (supportedLanguageNames[normalized]) {
    return normalized;
  }
  return "en";
}

export function getAzureTtsVoiceName(locale: string): string {
  const normalized = (locale || "en-US").trim().toLowerCase();
  switch (normalized) {
    case "en-us":
      return "en-US-JennyNeural";
    case "es-es":
      return "es-ES-ElviraNeural";
    case "fr-fr":
      return "fr-FR-DeniseNeural";
    case "de-de":
      return "de-DE-KatjaNeural";
    case "it-it":
      return "it-IT-ElsaNeural";
    case "pt-pt":
      return "pt-PT-RaquelNeural";
    case "zh-cn":
      return "zh-CN-XiaoxiaoNeural";
    case "ja-jp":
      return "ja-JP-NanamiNeural";
    case "ko-kr":
      return "ko-KR-SunHiNeural";
    case "ar-sa":
      return "ar-SA-ZariyahNeural";
    case "hi-in":
      return "hi-IN-SwaraNeural";
    case "fa-ir":
      return "fa-IR-DilaraNeural";
    default:
      return "en-US-JennyNeural";
  }
}
