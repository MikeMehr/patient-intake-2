/**
 * Client-side counterpart to resolveAppUrl (src/lib/app-url.ts), for "use client" pages
 * that build links to display or copy — the provider intake links and the public booking
 * link on the Booking Dashboard.
 *
 * Lives apart from app-url.ts so client bundles don't pull in its next/server import.
 *
 * NEXT_PUBLIC_APP_URL is inlined at BUILD time, so a build that ran without it bakes in
 * an empty string permanently — setting the variable in Azure afterwards does not fix
 * already-built pages. Falling back to the browser's own origin means a missing or stale
 * build-time value (or a future domain move) can never render a dead localhost link.
 */
export function resolveClientAppUrl(): string {
  const envUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (envUrl) return envUrl;
  if (typeof window !== "undefined") return window.location.origin;
  return "https://physician.health-assist.org";
}
