import { NextResponse, type NextRequest } from "next/server";

// ── Security headers ─────────────────────────────────────────────────────────

function buildCspHeader(pathname: string, nonce: string) {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const isLegacyEformPath = pathname.startsWith("/eforms/");
  // Development: keep unsafe-inline + unsafe-eval for HMR/fast-refresh.
  // Production: 'self' covers static /_next/static/chunks/*.js files loaded
  // via <script src>. The nonce covers any inline scripts Next.js generates
  // for hydration. Do NOT use 'strict-dynamic' here — it causes 'self' to be
  // ignored for <script src> elements, which breaks all chunk loading.
  const scriptSrc = isDevelopment || isLegacyEformPath
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce}'`;
  // The secure file-share feature uploads large files directly from the browser
  // to Azure Blob Storage via a write-SAS (bypassing the server request-size
  // limit), so connect-src must allow that account host. Scope to the specific
  // account when known, else any Azure Blob host.
  const blobHost = process.env.AZURE_STORAGE_ACCOUNT_NAME
    ? `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`
    : "https://*.blob.core.windows.net";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self' data: blob:",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob: data:",
    // Absent originally, so blob-backed workers fell through to default-src 'self' and were
    // blocked. Unrelated to video and kept: a genuine fix either way.
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    // Most external API calls (Azure OpenAI, Speech, Document Intelligence,
    // Resend) are made server-side. The one browser→external call is the direct
    // upload to Azure Blob Storage for secure file sharing.
    `connect-src 'self' ${blobHost}`,
  ].join("; ");
}

function applySecurityHeaders(res: NextResponse, pathname: string, nonce: string): void {
  res.headers.set("Content-Security-Policy", buildCspHeader(pathname, nonce));
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  // Video consultations run on Doxy.me, which the patient opens directly in their own tab —
  // nothing is embedded here, so this app needs no camera at all. microphone=(self) stays for
  // dictation and transcription.
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
 * Routes that are whitelisted as public even though they fall under a
 * normally-protected prefix.  The OSCAR OAuth callback must be public
 * because the browser arrives here via a cross-site redirect from OSCAR
 * and cannot carry the physician_session cookie at that point.
 * The oauth_token / oauth_verifier values provide sufficient security.
 */
const PUBLIC_EXCEPTIONS = new Set<string>([
  "/api/admin/emr/oscar/callback",
  // Day billing asks this route for a diagnostic code. The caller is the OSCAR server itself, not
  // a browser, so there is no physician_session cookie to present and the prefix guard would 401
  // it — which is exactly what happened the first time it ran. The route authenticates itself with
  // a shared secret compared in constant time, and returns 404 when that secret is unconfigured,
  // so it is never reachable unauthenticated. Same reasoning as the OAuth callback above.
  "/api/emr/oscar/billing-dx",
]);

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
  // Public exceptions take priority — never block these even if they match a
  // protected prefix (e.g. the OSCAR OAuth callback lives under /api/admin/).
  if (PUBLIC_EXCEPTIONS.has(pathname)) return false;
  if (PHYSICIAN_API_ROUTES.has(pathname)) return true;
  // Match both the exact root (e.g. "/api/patients") and any sub-path ("/api/patients/123").
  return PHYSICIAN_API_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) || pathname === prefix.replace(/\/$/, ""),
  );
}

// ── Main middleware ──────────────────────────────────────────────────────────

// Generate or propagate a request ID, attach to request and response headers.
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // ── Legacy host redirect ───────────────────────────────────────────────
  // The physician dashboard moved to physician.health-assist.org. The old
  // mymd.health-assist.org host stays bound in Azure so existing bookmarks,
  // OSCAR eform links, and patient-record emails keep working — but every
  // request is permanently redirected to the new host, preserving path+query.
  // Only fires for the exact old host, so there is no redirect loop.
  if (req.headers.get("host") === "mymd.health-assist.org") {
    return NextResponse.redirect(
      new URL(pathname + search, "https://physician.health-assist.org"),
      301,
    );
  }

  const incomingId =
    req.headers.get("x-request-id") ||
    req.headers.get("x-correlation-id") ||
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2));

  // One random nonce per request, base64-encoded. Used in script-src in
  // production so we can drop 'unsafe-inline'. Next.js reads x-nonce from
  // the request headers and automatically stamps it onto its own generated
  // script tags (hydration bundles, route prefetch, etc.).
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // ── Physician page routes ──────────────────────────────────────────────
  // Redirect to login so unauthenticated users never see even the page shell.
  //
  // NOTE: /launch/* is deliberately NOT guarded here (and needs no
  // PUBLIC_EXCEPTIONS entry — that set is only consulted for API paths, see
  // requiresPhysicianSession above). /launch/oscar is the SameSite=Strict
  // bounce entry point: OSCAR opens it cross-site, so it must be reachable
  // with no session cookie. It carries no PHI and only client-side redirects
  // to a hard-coded same-origin path, which re-attaches the Strict cookie.
  if (pathname.startsWith("/physician")) {
    if (!hasValidSessionCookie(req)) {
      const loginUrl = new URL("/auth/login", req.url);
      // pathname + search, NOT encodeURIComponent(pathname): searchParams.set
      // already percent-encodes, so wrapping it double-encodes the value, and
      // dropping `search` loses deep-link params (e.g. ?launch=oscar).
      const returnTo = pathname + search;
      if (returnTo.length <= 512) loginUrl.searchParams.set("returnTo", returnTo);
      const res = NextResponse.redirect(loginUrl);
      applySecurityHeaders(res, pathname, nonce);
      return res;
    }
  }

  // ── Booking Dashboard page routes ──────────────────────────────────────
  // Same purpose as the /physician block above. src/app/org/(protected)/layout.tsx is the
  // real guard — it can read the DB and check the caller's booking authority, which this
  // cannot. This is the edge backstop: a page file added to /org outside the (protected)
  // group would otherwise get no guard at all, so anonymous visitors fail closed here
  // regardless of where the file lives. /org/login must stay reachable.
  // Carries returnTo (like the /physician block) so a deep link such as
  // /org/documents — the eChart "Request Docs" button — survives login.
  if (pathname.startsWith("/org") && pathname !== "/org/login") {
    if (!hasValidSessionCookie(req)) {
      const loginUrl = new URL("/org/login", req.url);
      const returnTo = pathname + search;
      if (returnTo.length <= 512) loginUrl.searchParams.set("returnTo", returnTo);
      const res = NextResponse.redirect(loginUrl);
      applySecurityHeaders(res, pathname, nonce);
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
      applySecurityHeaders(res, pathname, nonce);
      return res;
    }
  }

  // ── All other routes ───────────────────────────────────────────────────
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", incomingId);
  // Server layouts cannot see the request URL, but they need it to stamp
  // returnTo on their login redirects. The guards above only fire when the
  // cookie is absent/malformed — an EXPIRED cookie passes them and is caught
  // by the layout's DB check instead, and without this header that redirect
  // would lose the deep link (e.g. /org/documents from the eChart button).
  requestHeaders.set("x-pathname", (pathname + search).slice(0, 512));
  // Forward nonce so Next.js server components can read it via headers() and
  // pass it to any <Script nonce={nonce}> elements they render.
  requestHeaders.set("x-nonce", nonce);

  const res = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  res.headers.set("x-request-id", incomingId);
  applySecurityHeaders(res, pathname, nonce);
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
