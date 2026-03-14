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
  ])("does not block public route %s", (path) => {
    const res = proxy(makeRequest(path)); // no cookie
    expect(res.status).toBe(200);
  });
});
