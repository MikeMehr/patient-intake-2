/**
 * Quick guardrail: fail CI if .env files contain obvious secrets or DEBUG_LOGGING is true in production.
 * This is a lightweight heuristic, not a full secret scanner.
 */
import fs from "fs";
import path from "path";

const envFiles = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.prod",
  ".env.staging",
  ".env.development",
].filter((f) => fs.existsSync(f));

const forbiddenKeys = [
  "AZURE_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_AI_API_KEY",
  "DATABASE_URL",
  "RESEND_API_KEY",
  "SESSION_SECRET",
];

let hasError = false;

for (const envFile of envFiles) {
  const content = fs.readFileSync(envFile, "utf8");
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const [key, value = ""] = trimmed.split("=", 2);
    if (forbiddenKeys.includes(key)) {
      if (value && !value.toLowerCase().includes("changeme") && !value.toLowerCase().includes("placeholder")) {
        console.error(`[check-env] ${envFile}:${idx + 1} contains value for ${key}. Store secrets in Key Vault or CI vars, not in repo env files.`);
        hasError = true;
      }
    }
    if (key === "DEBUG_LOGGING" && value.trim() === "true" && envFile.includes("prod")) {
      console.error(`[check-env] ${envFile}:${idx + 1} has DEBUG_LOGGING=true; disable in production.`);
      hasError = true;
    }
  });
}

if (hasError) {
  process.exit(1);
} else {
  console.log("[check-env] OK");
}



