export const languageOptions = [
  { value: "en", label: "English (default)" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "zh", label: "Chinese (Simplified)" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "fa", label: "Farsi (Persian)" },
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
    case "fa":
      return "fa-IR";
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
