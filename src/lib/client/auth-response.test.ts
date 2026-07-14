import { describe, expect, it } from "vitest";
import { classifyAuthFailure } from "./auth-response";

describe("classifyAuthFailure", () => {
  it("treats 401 as needing a fresh login", () => {
    expect(classifyAuthFailure(new Response(null, { status: 401 }))).toBe(
      "unauthenticated",
    );
  });

  // Provider-only routes answer 403 when the shared session cookie holds a
  // Booking-admin session. That is recoverable by switching account, so it must
  // not be conflated with 401 (which discards the page and any unsaved work).
  it("treats 403 as a recoverable wrong-account session", () => {
    expect(classifyAuthFailure(new Response(null, { status: 403 }))).toBe(
      "wrong_account",
    );
  });

  it("ignores success and non-auth errors", () => {
    for (const status of [200, 400, 422, 429, 500, 503]) {
      expect(classifyAuthFailure(new Response(null, { status }))).toBeNull();
    }
  });
});
