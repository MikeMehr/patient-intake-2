const DEFAULT_CONTEXT_WORDS = [
  "health-assist",
  "healthassist",
  "mymd",
  "healthassistai",
  "admin",
  "provider",
  "doctor",
  "physician",
  "support",
  "prod",
  "staging",
  "dev",
];

export const CONTEXT_PASSWORD_ERROR =
  "Password contains organization or system words and is too easy to guess.";

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[30]/g, (char) => (char === "3" ? "e" : "o"))
    .replace(/[1]/g, "i")
    .replace(/[@]/g, "a")
    .replace(/[$]/g, "s")
    .replace(/[^a-z0-9]/g, "");
}

function getConfiguredContextWords(): string[] {
  const fromEnv = (process.env.PASSWORD_CONTEXT_WORDS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...DEFAULT_CONTEXT_WORDS, ...fromEnv];
}

export function isPasswordContextWordSafe(password: string): boolean {
  const normalizedPassword = normalizeForMatch(password);
  const words = getConfiguredContextWords();

  return !words.some((word) => {
    const normalizedWord = normalizeForMatch(word);
    return normalizedWord.length >= 3 && normalizedPassword.includes(normalizedWord);
  });
}

