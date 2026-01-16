const debugLoggingEnabled =
  process.env.DEBUG_LOGGING === "true" && process.env.NODE_ENV !== "production";

/**
 * Emit debug logs only when explicitly enabled and never in production.
 * Designed to avoid accidental PHI leakage in production logs.
 */
export function logDebug(message: string, meta?: Record<string, unknown>) {
  if (!debugLoggingEnabled) return;
  if (meta) {
    console.log(message, meta);
    return;
  }
  console.log(message);
}

