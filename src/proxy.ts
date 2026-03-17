import { NextResponse, type NextRequest } from "next/server";

// ── Security headers ─────────────────────────────────────────────────────────

function buildCspHeader(pathname: string) {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const isLegacyEformPath = pathname.startsWith("/eforms/");
  const scriptSrc = isDevelopment || isLegacyEformPath
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";
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
    scriptSrc,
    "connect-src 'self' https: wss:",
  ].join("; ");
}

function applySecurityHeaders(res: NextResponse, pathname: string): void {
  res.headers.set("Content-Security-Policy", buildCspHeader(pathname));
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
}

// ── Physician session guard ──────────────────────────────────────────────────

const SESSION_COOKIE = "physician_session";

/**
 * Raw session tokens are 32 random bytes hex-encoded → 64 lowercase hex chars.
 * This is a format check only; DB validity is verified in the route handler.
 */
const RAW_TOKEN_RE = /^[a-f0-9]{64}$/;

function hasValidSessionCookie(request: NextRequest): boolean {
  const value = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  return RAW_TOKEN_RE.test(value);
}

/**
 * API prefixes where every sub-route requires a physician session.
 * New routes added under these prefixes are automatically protected.
 *
 * ADDING A NEW PROTECTED PREFIX: add it here and to the `matcher` below.
 */
const PHYSICIAN_API_PREFIXES: string[] = [
  "/api/admin/",
  "/api/org/",
  "/api/patients/",
  "/api/lab-requisitions/",
  "/api/prescriptions/",
  "/api/physician/",
  "/api/emr/",
];

/**
 * Individual routes that require a physician session but live in namespaces
 * that also contain public routes (so protecting the whole prefix isn't safe).
 *
 * ADDING A NEW PROTECTED ROUTE: add it here and to the `matcher` below.
 */
const PHYSICIAN_API_ROUTES = new Set<string>([
  "/api/invitations/send",
  "/api/invitations/list",
  "/api/auth/me",
  "/api/auth/ping",
  "/api/auth/logout",
  "/api/auth/webauthn/register/options",
  "/api/auth/webauthn/register/verify",
  "/api/auth/webauthn/credentials",
]);

function requiresPhysicianSession(pathname: string): boolean {
  if (PHYSICIAN_API_ROUTES.has(pathname)) return true;
  // Match both the exact root (e.g. "/api/patients") and any sub-path ("/api/patients/123").
  return PHYSICIAN_API_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) || pathname === prefix.replace(/\/$/, ""),
  );
}

// ── Main middleware ──────────────────────────────────────────────────────────

// Generate or propagate a request ID, attach to request and response headers.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const incomingId =
    req.headers.get("x-request-id") ||
    req.headers.get("x-correlation-id") ||
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2));

  // ── Physician page routes ──────────────────────────────────────────────
  // Redirect to login so unauthenticated users never see even the page shell.
  if (pathname.startsWith("/physician")) {
    if (!hasValidSessionCookie(req)) {
      const loginUrl = new URL("/auth/login", req.url);
      loginUrl.searchParams.set("returnTo", encodeURIComponent(pathname));
      const res = NextResponse.redirect(loginUrl);
      applySecurityHeaders(res, pathname);
      return res;
    }
  }

  // ── Physician API routes ───────────────────────────────────────────────
  // Return 401 early without reaching the route handler.
  if (requiresPhysicianSession(pathname)) {
    if (!hasValidSessionCookie(req)) {
      const res = NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
      applySecurityHeaders(res, pathname);
      return res;
    }
  }

  // ── All other routes ───────────────────────────────────────────────────
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", incomingId);

  const res = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  res.headers.set("x-request-id", incomingId);
  applySecurityHeaders(res, pathname);
  return res;
}

export const config = {
  matcher: [
    /*
     * Security headers: applied to all routes.
     * Auth guards: the proxy() function selectively checks within this broad matcher.
     *
     * To add a new protected route or prefix, update PHYSICIAN_API_PREFIXES or
     * PHYSICIAN_API_ROUTES above AND add a corresponding entry to this matcher.
     */
    "/:path*",
  ],
};
