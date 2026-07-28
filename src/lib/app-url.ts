import { NextRequest } from "next/server";

/**
 * Resolve the public base URL for building links in emails / responses.
 * Prefers NEXT_PUBLIC_APP_URL, but in dev falls back to the request origin so a
 * localhost port mismatch doesn't produce broken links.
 */
export function resolveAppUrl(request: NextRequest): string {
  const envUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const requestOrigin = request.nextUrl.origin;

  if (!envUrl) {
    return requestOrigin || "http://localhost:3000";
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      const env = new URL(envUrl);
      const req = new URL(requestOrigin);
      if (
        env.hostname === "localhost" &&
        req.hostname === "localhost" &&
        env.port !== req.port
      ) {
        return requestOrigin;
      }
    } catch {
      return requestOrigin || "http://localhost:3000";
    }
  }

  return envUrl;
}
