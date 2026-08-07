import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  // The camera is disabled site-wide by default. These tests exist to pin down that the
  // exception is exactly two path prefixes wide — the failure mode worth catching is not
  // "video is broken" (obvious in seconds) but "video quietly opened the camera everywhere".

  describe("video-visit headers", () => {
    const DOMAIN = "clinic.daily.co";
    beforeEach(() => {
      process.env.DAILY_DOMAIN = DOMAIN;
    });
    afterEach(() => {
      delete process.env.DAILY_DOMAIN;
    });

    it("delegates camera and microphone to Daily on the patient join page", () => {
      const res = proxy(makeRequest("/visit/" + "a".repeat(64)));
      const policy = res.headers.get("Permissions-Policy") ?? "";
      expect(policy).toContain(`camera=(self "https://${DOMAIN}")`);
      expect(policy).toContain(`microphone=(self "https://${DOMAIN}")`);
    });

    it("delegates camera and microphone on the provider console", () => {
      const res = proxy(makeRequest("/physician/video?oscarApptNo=1", VALID_TOKEN));
      expect(res.headers.get("Permissions-Policy") ?? "").toContain(`camera=(self "https://${DOMAIN}")`);
    });

    it("keeps the camera disabled on every other physician page", () => {
      const res = proxy(makeRequest("/physician/dashboard", VALID_TOKEN));
      const policy = res.headers.get("Permissions-Policy") ?? "";
      expect(policy).toContain("camera=()");
      // Dictation depends on this and must not be narrowed while widening camera.
      expect(policy).toContain("microphone=(self)");
    });

    it("keeps the camera disabled on ordinary public pages", () => {
      const res = proxy(makeRequest("/booking/some-clinic"));
      expect(res.headers.get("Permissions-Policy") ?? "").toContain("camera=()");
    });

    it("allows the Daily iframe and its transport only on video paths", () => {
      const video = proxy(makeRequest("/visit/" + "a".repeat(64)));
      const csp = video.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("frame-src 'self' data: blob: https://*.daily.co");
      expect(csp).toContain("https://*.daily.co wss://*.daily.co");

      const other = proxy(makeRequest("/booking/some-clinic"));
      expect(other.headers.get("Content-Security-Policy") ?? "").not.toContain("daily.co");
    });

    it("never lets anyone frame us, video path or not", () => {
      // frame-ancestors governs who embeds *us*; Daily is embedded *by* us, so widening this
      // would be a pure regression.
      const res = proxy(makeRequest("/visit/" + "a".repeat(64)));
      expect(res.headers.get("Content-Security-Policy") ?? "").toContain("frame-ancestors 'none'");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    });

    it("falls back to the restrictive policy when DAILY_DOMAIN is unset", () => {
      // A wildcard is not valid in a Permissions-Policy allowlist, so there is no safe generic
      // value — better to fail visibly on a permissions error than emit a malformed header.
      delete process.env.DAILY_DOMAIN;
      const res = proxy(makeRequest("/visit/" + "a".repeat(64)));
      expect(res.headers.get("Permissions-Policy") ?? "").toContain("camera=()");
    });

    it("ignores a malformed DAILY_DOMAIN rather than injecting it into the header", () => {
      process.env.DAILY_DOMAIN = 'evil.com"), camera=*, x=(';
      const res = proxy(makeRequest("/visit/" + "a".repeat(64)));
      expect(res.headers.get("Permissions-Policy") ?? "").toContain("camera=()");
    });

    it("still requires a session for the provider video console", () => {
      const res = proxy(makeRequest("/physician/video?oscarApptNo=1")); // no cookie
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/auth/login");
    });

    it("leaves the OSCAR video launch page public", () => {
      // Same reasoning as /launch/oscar: OSCAR opens it cross-site, so the SameSite=Strict
      // cookie cannot be present on that first hop.
      const res = proxy(makeRequest("/launch/oscar-video?oscarApptNo=123"));
      expect(res.status).toBe(200);
    });
  });
});
