// Application Insights telemetry for production observability.
// Initialized via instrumentation.ts register() hook on server start.
// Requires APPLICATIONINSIGHTS_CONNECTION_STRING env var (set via Key Vault reference).
//
// What it tracks:
// - HTTP request/response metrics (duration, status codes, routes)
// - Unhandled exceptions and console.error calls
// - Dependency calls (outbound HTTP to Azure OpenAI, Postgres, etc.)
// - Custom events via trackEvent() / trackException()
//
// PHI safety: Application Insights does NOT capture request/response bodies by default.
// Only metadata (URL, status, duration, headers) is collected.
// A telemetry processor strips query params that could contain patient data.

let isInitialized = false;

export async function initTelemetry(): Promise<void> {
  if (isInitialized) return;

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    console.info(
      "[telemetry] APPLICATIONINSIGHTS_CONNECTION_STRING not set — telemetry disabled."
    );
    return;
  }

  try {
    const appInsights = await import("applicationinsights");

    appInsights
      .setup(connectionString)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(true, true) // capture console.error as exceptions
      .setAutoCollectPreAggregatedMetrics(true)
      .setSendLiveMetrics(false) // disable Live Metrics to reduce overhead
      .setUseDiskRetryCaching(true);

    // Strip PHI from telemetry — remove query params that could contain patient data
    appInsights.defaultClient.addTelemetryProcessor((envelope) => {
      if (envelope.data?.baseData?.url) {
        try {
          const url = new URL(
            envelope.data.baseData.url,
            "https://placeholder.local"
          );
          url.searchParams.delete("patientId");
          url.searchParams.delete("name");
          url.searchParams.delete("email");
          url.searchParams.delete("dob");
          url.searchParams.delete("token");
          envelope.data.baseData.url = url.pathname + url.search;
        } catch {
          // URL parsing failed — leave as-is
        }
      }
      return true;
    });

    appInsights.start();
    isInitialized = true;
    console.info("[telemetry] Application Insights initialized.");
  } catch (error) {
    // Don't crash the app if telemetry fails to initialize
    console.error("[telemetry] Failed to initialize Application Insights:", error);
  }
}

/**
 * Track a custom event (e.g. audit events, business metrics).
 * No-op if telemetry is not initialized.
 */
export function trackEvent(
  name: string,
  properties?: Record<string, string>,
  measurements?: Record<string, number>
): void {
  if (!isInitialized) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appInsights = require("applicationinsights");
    appInsights.defaultClient?.trackEvent({ name, properties, measurements });
  } catch {
    // Silently ignore
  }
}

/**
 * Track an exception.
 * No-op if telemetry is not initialized.
 */
export function trackException(
  error: Error,
  properties?: Record<string, string>
): void {
  if (!isInitialized) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appInsights = require("applicationinsights");
    appInsights.defaultClient?.trackException({
      exception: error,
      properties,
    });
  } catch {
    // Silently ignore
  }
}
