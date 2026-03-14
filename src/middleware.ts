/**
 * Next.js middleware — centralized first line of defense for physician-auth routes.
 *
 * PURPOSE
 * -------
 * Route handlers are still the authoritative auth layer (full DB session lookup,
 * expiry enforcement, role checks). This middleware adds a fast, no-DB-call gate
 * that catches the most common failure mode: a request with no session cookie at all.
 *
 * WHAT IT CHECKS
 * --------------
 * It validates that a `physician_session` cookie exists and matches the expected
 * format (64-char hex = randomBytes(32).toString("hex")). A cookie that passes
 * this check is NOT guaranteed to be valid — the handler will still verify it
 * against the DB. A missing or malformed cookie is, however, definitely invalid.
 *
 * PROTECTED ROUTES
 * ----------------
 * • /physician/**         — page routes; missing cookie → redirect to /auth/login
 * • PHYSICIAN_API_PREFIXES — API namespaces where every sub-route requires a
 *   physician session; missing cookie → 401 JSON
 * • PHYSICIAN_API_ROUTES   — individual routes in mixed namespaces that require
 *   a physician session
 *
 * ADDING A NEW PROTECTED ROUTE
 * ----------------------------
 * • If the route lives under an already-protected prefix, no change needed.
 * • If it's a new top-level namespace (e.g. /api/billing/**), add it to
 *   PHYSICIAN_API_PREFIXES below.
 * • If it's a one-off route in a mixed namespace, add it to PHYSICIAN_API_ROUTES.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

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
 */
const PHYSICIAN_API_ROUTES = new Set<string>([
  "/api/invitations/send",
  "/api/invitations/list",
  "/api/auth/me",
  "/api/auth/ping",
  "/api/auth/logout",
]);

function requiresPhysicianSession(pathname: string): boolean {
  if (PHYSICIAN_API_ROUTES.has(pathname)) return true;
  // Match both the exact root (e.g. "/api/patients") and any sub-path ("/api/patients/123").
  return PHYSICIAN_API_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) || pathname === prefix.replace(/\/$/, ""),
  );
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // ── Physician page routes ────────────────────────────────────────────────
  // Redirect to login so unauthenticated users never see even the page shell.
  if (pathname.startsWith("/physician")) {
    if (!hasValidSessionCookie(request)) {
      const loginUrl = new URL("/auth/login", request.url);
      loginUrl.searchParams.set("returnTo", encodeURIComponent(pathname));
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── Physician API routes ─────────────────────────────────────────────────
  // Return 401 early without reaching the route handler.
  if (requiresPhysicianSession(pathname)) {
    if (!hasValidSessionCookie(request)) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Physician page routes
    "/physician/:path*",
    // Protected API namespaces (must mirror PHYSICIAN_API_PREFIXES above)
    "/api/admin/:path*",
    "/api/org/:path*",
    "/api/patients/:path*",
    "/api/lab-requisitions/:path*",
    "/api/prescriptions/:path*",
    "/api/physician/:path*",
    "/api/emr/:path*",
    // Individual routes in mixed namespaces (must mirror PHYSICIAN_API_ROUTES above)
    "/api/invitations/send",
    "/api/invitations/list",
    "/api/auth/me",
    "/api/auth/ping",
    "/api/auth/logout",
  ],
};
