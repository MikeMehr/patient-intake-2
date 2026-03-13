// Next.js instrumentation hook — runs once when the server starts.
// Initializes Application Insights for production observability.
// Only loads in the Node.js runtime (not edge) to avoid bundling issues.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("./lib/telemetry");
    await initTelemetry();
  }
}
