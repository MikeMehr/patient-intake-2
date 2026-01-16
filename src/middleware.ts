import { NextResponse, type NextRequest } from "next/server";

// Generate or propagate a request ID, attach to request and response headers.
export function middleware(req: NextRequest) {
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

