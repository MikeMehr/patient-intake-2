// Next.js instrumentation hook — runs once when the server starts.
// 1. Applies any pending database migrations so production is always up to date.
// 2. Initializes Application Insights for production observability.
// Only loads in the Node.js runtime (not edge) to avoid bundling issues.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./lib/run-migrations");
    await runMigrations();
    const { initTelemetry } = await import("./lib/telemetry");
    await initTelemetry();
  }
}
