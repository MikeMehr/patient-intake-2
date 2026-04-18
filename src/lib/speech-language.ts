export const languageOptions = [
  { value: "en", label: "English (default)" },
  { value: "am", label: "Amharic" },
  { value: "ar", label: "Arabic" },
  { value: "bn", label: "Bengali" },
  { value: "bla", label: "Blackfoot" },
  { value: "bs", label: "Bosnian" },
  { value: "my", label: "Burmese" },
  { value: "yue", label: "Cantonese" },
  { value: "chr", label: "Cherokee" },
  { value: "cr", label: "Cree" },
  { value: "hr", label: "Croatian" },
  { value: "cs", label: "Czech" },
  { value: "den", label: "Dene (Athabaskan languages)" },
  { value: "nl", label: "Dutch" },
  { value: "fa", label: "Farsi (Persian)" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "el", label: "Greek" },
  { value: "gu", label: "Gujarati" },
  { value: "gwi", label: "Gwich'in" },
  { value: "hai", label: "Haida" },
  { value: "he", label: "Hebrew" },
  { value: "hi", label: "Hindi" },
  { value: "hu", label: "Hungarian" },
  { value: "iu", label: "Inuktitut" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "ml", label: "Malayalam" },
  { value: "zh", label: "Mandarin Chinese" },
  { value: "mic", label: "Mi'kmaq" },
  { value: "moh", label: "Mohawk" },
  { value: "nuk", label: "Nuu-chah-nulth" },
  { value: "oj", label: "Ojibwe (Anishinaabemowin)" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "pa", label: "Punjabi" },
  { value: "ro", label: "Romanian" },
  { value: "ru", label: "Russian" },
  { value: "sal", label: "Salish languages" },
  { value: "sr", label: "Serbian" },
  { value: "scs", label: "Slavey" },
  { value: "so", label: "Somali" },
  { value: "es", label: "Spanish" },
  { value: "sw", label: "Swahili" },
  { value: "tl", label: "Tagalog (Filipino)" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "th", label: "Thai" },
  { value: "ti", label: "Tigrinya" },
  { value: "tr", label: "Turkish" },
  { value: "uk", label: "Ukrainian" },
  { value: "ur", label: "Urdu" },
  { value: "vi", label: "Vietnamese" },
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
    case "ml":
      return "ml-IN";
    case "pa":
      return "pa-IN";
    case "pl":
      return "pl-PL";
    case "ro":
      return "ro-RO";
    case "ru":
      return "ru-RU";
    case "so":
      return "so-SO";
    case "sr":
      return "sr-RS";
    case "sw":
      return "sw-KE";
    case "ta":
      return "ta-IN";
    case "te":
      return "te-IN";
    case "th":
      return "th-TH";
    case "tl":
      return "fil-PH";
    case "tr":
      return "tr-TR";
    case "uk":
      return "uk-UA";
    case "ur":
      return "ur-PK";
    case "vi":
      return "vi-VN";
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
    case "fil-ph":
      return "fil-PH-BlessicaNeural";
    case "ml-in":
      return "ml-IN-SobhanaNeural";
    case "pa-in":
      return "pa-IN-OjasNeural";
    case "pl-pl":
      return "pl-PL-ZofiaNeural";
    case "ro-ro":
      return "ro-RO-AlinaNeural";
    case "ru-ru":
      return "ru-RU-SvetlanaNeural";
    case "so-so":
      return "so-SO-UbaxNeural";
    case "sr-rs":
      return "sr-RS-SophieNeural";
    case "sw-ke":
      return "sw-KE-ZuriNeural";
    case "ta-in":
      return "ta-IN-PallaviNeural";
    case "te-in":
      return "te-IN-ShrutiNeural";
    case "th-th":
      return "th-TH-PremwadeeNeural";
    case "tr-tr":
      return "tr-TR-EmelNeural";
    case "uk-ua":
      return "uk-UA-PolinaNeural";
    case "ur-pk":
      return "ur-PK-UzmaNeural";
    case "vi-vn":
      return "vi-VN-HoaiMyNeural";
    case "el-gr":
      return "el-GR-AthinaNeural";
    case "my-mm":
      return "my-MM-NilarNeural";
    case "gu-in":
      return "gu-IN-DhwaniNeural";
    case "he-il":
      return "he-IL-HilaNeural";
    case "am-et":
      return "am-ET-MekdesNeural";
    case "bn-in":
      return "bn-IN-TanishaaNeural";
    case "bs-ba":
      return "bs-BA-VesnaNeural";
    case "yue-hk":
      return "yue-HK-HiuGaaiNeural";
    case "hr-hr":
      return "hr-HR-GabrijelaNeural";
    case "cs-cz":
      return "cs-CZ-VlastaNeural";
    case "nl-nl":
      return "nl-NL-FennaNeural";
    case "hu-hu":
      return "hu-HU-NoemiNeural";
    default:
      return "en-US-JennyNeural";
  }
}
