import { NextResponse, type NextRequest } from "next/server";

function buildCspHeader() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self' data: blob:",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'self' https: wss:",
  ].join("; ");
}

// Generate or propagate a request ID, attach to request and response headers.
export function proxy(req: NextRequest) {
  const incomingId =
    req.headers.get("x-request-id") ||
    req.headers.get("x-correlation-id") ||
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2));

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", incomingId);

  const res = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  res.headers.set("x-request-id", incomingId);
  res.headers.set("Content-Security-Policy", buildCspHeader());
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }
  return res;
}

export const config = {
  matcher: [
    /*
     * Apply to all routes; adjust if you need to skip static assets.
     * You can exclude _next/static|_next/image etc. by narrowing this matcher if desired.
     */
    "/:path*",
  ],
};

