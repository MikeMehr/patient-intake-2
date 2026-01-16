/**
 * Ensures required environment variables are set in production.
 * Throws early to avoid running with missing secrets or verbose debug logging.
 */
export function ensureProdEnv(requiredKeys: string[]) {
  if (process.env.NODE_ENV !== "production") return;

  const missing = requiredKeys.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables in production: ${missing.join(", ")}`
    );
  }

  if (process.env.DEBUG_LOGGING === "true") {
    throw new Error("DEBUG_LOGGING must be false in production.");
  }
}



