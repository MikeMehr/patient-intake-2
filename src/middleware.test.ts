import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";
import { NextRequest } from "next/server";

const BASE = "https://example.com";

function makeRequest(path: string, sessionCookie?: string): NextRequest {
  const req = new NextRequest(`${BASE}${path}`);
  if (sessionCookie !== undefined) {
    req.cookies.set("physician_session", sessionCookie);
  }
  return req;
}

// A valid-format raw session token (64 lowercase hex chars).
const VALID_TOKEN = "a".repeat(64);

describe("middleware", () => {
  // ── Physician pages ──────────────────────────────────────────────────────

  it("redirects /physician/* to /auth/login when no cookie", () => {
    const res = proxy(makeRequest("/physician/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
  });

  it("redirects /physician/* to /auth/login when cookie is malformed", () => {
    const res = proxy(makeRequest("/physician/dashboard", "bad-token"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
  });

  it("includes returnTo param in redirect for physician pages", () => {
    const res = proxy(makeRequest("/physician/patients/123"));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("returnTo=");
  });

  it("encodes returnTo exactly once", () => {
    // Regression: the value used to be wrapped in encodeURIComponent before
    // being handed to searchParams.set, which encodes again — so consumers
    // read back "%2Fphysician%2F…" instead of a usable path.
    const res = proxy(makeRequest("/physician/patients/123"));
    const location = new URL(res.headers.get("location") ?? "", BASE);
    expect(location.searchParams.get("returnTo")).toBe("/physician/patients/123");
  });

  it("preserves the query string in returnTo", () => {
    // The OSCAR launch deep link carries ?launch=oscar&demographicNo=… and is
    // useless if login drops it.
    const res = proxy(makeRequest("/physician/transcription?launch=oscar&demographicNo=46"));
    const location = new URL(res.headers.get("location") ?? "", BASE);
    expect(location.searchParams.get("returnTo")).toBe(
      "/physician/transcription?launch=oscar&demographicNo=46",
    );
  });

  it("omits an over-long returnTo rather than building a huge redirect", () => {
    const res = proxy(makeRequest(`/physician/x?q=${"a".repeat(600)}`));
    const location = new URL(res.headers.get("location") ?? "", BASE);
    expect(location.searchParams.get("returnTo")).toBeNull();
  });

  // ── OSCAR launch bounce ──────────────────────────────────────────────────

  it("lets /launch/oscar through without a session cookie", () => {
    // This is the SameSite=Strict bounce entry point: OSCAR opens it
    // cross-site, so it MUST be reachable with no cookie or the whole
    // Transcribe flow dead-ends at the login page.
    const res = proxy(makeRequest("/launch/oscar?demographicNo=46"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still applies security headers to /launch/oscar", () => {
    const res = proxy(makeRequest("/launch/oscar"));
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("passes /physician/* through when valid cookie is present", () => {
    const res = proxy(makeRequest("/physician/dashboard", VALID_TOKEN));
    expect(res.status).toBe(200);
  });

  // ── Booking Dashboard page routes ────────────────────────────────────────
  // Edge backstop only. The real authority check is in src/app/org/(protected)/layout.tsx,
  // which can read the DB; this just stops anonymous visitors seeing the shell, including
  // on any /org page added outside the (protected) group.

  it.each([
    "/org/dashboard",
    "/org/documents",
    "/org/appointments",
    "/org/slots",
  ])("redirects %s to /org/login when no cookie", (path) => {
    const res = proxy(makeRequest(path));
    const location = new URL(res.headers.get("location") ?? "", BASE);
    expect(location.pathname).toBe("/org/login");
  });

  it("redirects /org/* to /org/login when cookie is malformed", () => {
    const res = proxy(makeRequest("/org/documents", "bad-token"));
    const location = new URL(res.headers.get("location") ?? "", BASE);
    expect(location.pathname).toBe("/org/login");
  });

  it("leaves /org/login reachable without a cookie", () => {
    // Guarding this would be an infinite redirect loop.
    const res = proxy(makeRequest("/org/login"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("passes /org/* through when valid cookie is present", () => {
    const res = proxy(makeRequest("/org/documents", VALID_TOKEN));
    expect(res.status).toBe(200);
  });

  // ── Protected API prefixes ───────────────────────────────────────────────

  it.each([
    "/api/admin/providers",
    "/api/org/organization",
    "/api/patients/search",
    "/api/lab-requisitions",
    "/api/prescriptions",
    "/api/physician/transcription/list",
    "/api/emr/oscar/patient-lookup",
  ])("returns 401 for %s without cookie", (path) => {
    const res = proxy(makeRequest(path));
    expect(res.status).toBe(401);
  });

  it.each([
    "/api/admin/providers",
    "/api/org/organization",
    "/api/patients/search",
    "/api/lab-requisitions",
    "/api/prescriptions",
    "/api/physician/transcription/list",
    "/api/emr/oscar/patient-lookup",
  ])("passes %s through with valid cookie", (path) => {
    const res = proxy(makeRequest(path, VALID_TOKEN));
    expect(res.status).toBe(200);
  });

  // ── Named individual physician routes ────────────────────────────────────

  it.each([
    "/api/invitations/send",
    "/api/invitations/list",
    "/api/auth/me",
    "/api/auth/ping",
    "/api/auth/logout",
  ])("returns 401 for %s without cookie", (path) => {
    const res = proxy(makeRequest(path));
    expect(res.status).toBe(401);
  });

  it.each([
    "/api/invitations/send",
    "/api/invitations/list",
    "/api/auth/me",
    "/api/auth/ping",
    "/api/auth/logout",
  ])("passes %s through with valid cookie", (path) => {
    const res = proxy(makeRequest(path, VALID_TOKEN));
    expect(res.status).toBe(200);
  });

  // ── Public routes — never blocked ────────────────────────────────────────

  it.each([
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/reset-password",
    "/api/auth/login/mfa/verify",
    "/api/invitations/open/sometoken",
    "/api/invitations/otp/request",
    "/api/invitations/otp/verify",
    "/api/invitations/context",
    "/api/invitations/session/clear",
    "/api/physicians/by-slug/dr-smith",
    "/api/health",
    "/api/runtime-config",
    "/intake/invite/sometoken",
    "/auth/login",
    // OSCAR OAuth callback — must be public (browser arrives via cross-site redirect)
    "/api/admin/emr/oscar/callback",
    // Day billing's diagnostic-code lookup — called by the OSCAR server, which has no session
    // cookie to present. It guards itself with a shared secret. Without this exception the
    // /api/emr/ prefix guard 401s it and every visit falls back to a hand-typed code.
    "/api/emr/oscar/billing-dx",
  ])("does not block public route %s", (path) => {
    const res = proxy(makeRequest(path)); // no cookie
    expect(res.status).toBe(200);
  });

  // ── Video visits ─────────────────────────────────────────────────────────
  // Video moved to Doxy.me, which the patient opens directly in their own tab. Nothing is
  // embedded in this origin any more, so the app needs no camera and no third-party frame host.
  // These pin the revert: the Daily-era headers briefly delegated camera to a *.daily.co origin,
  // and that must not creep back without someone deciding to.

  describe("video-visit headers are gone", () => {
    it("never delegates the camera to a third-party origin", () => {
      for (const path of ["/booking/some-clinic", "/physician/dashboard", "/org/appointments"]) {
        const res = proxy(makeRequest(path, VALID_TOKEN));
        const policy = res.headers.get("Permissions-Policy") ?? "";
        expect(policy).toContain("camera=()");
        expect(policy).not.toContain("daily.co");
        // Dictation and transcription depend on this; the revert must not have taken it too.
        expect(policy).toContain("microphone=(self)");
      }
    });

    it("has no third-party frame or connect host in the CSP", () => {
      const res = proxy(makeRequest("/booking/some-clinic"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).not.toContain("daily.co");
      expect(csp).toContain("frame-src 'self' data: blob:");
    });

    it("still refuses to let anyone frame us", () => {
      const res = proxy(makeRequest("/booking/some-clinic"));
      expect(res.headers.get("Content-Security-Policy") ?? "").toContain("frame-ancestors 'none'");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    });

    it("keeps /launch/oscar-video public — the OSCAR day-sheet button still routes through it", () => {
      const res = proxy(makeRequest("/launch/oscar-video?oscarApptNo=123"));
      expect(res.status).toBe(200);
    });

    it("still requires a session for the provider video launcher", () => {
      const res = proxy(makeRequest("/physician/video?oscarApptNo=1"));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/auth/login");
    });
  });
});
