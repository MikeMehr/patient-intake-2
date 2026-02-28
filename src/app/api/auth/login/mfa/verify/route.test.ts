import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyMfaChallengeMock = vi.hoisted(() => vi.fn());
const consumeVerifiedMfaChallengeMock = vi.hoisted(() => vi.fn());
const getAuthUserByTypeAndIdMock = vi.hoisted(() => vi.fn());
const createSessionMock = vi.hoisted(() => vi.fn());
const consumeDbRateLimitMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-mfa", () => ({
  verifyMfaChallenge: (...args: unknown[]) => verifyMfaChallengeMock(...args),
  consumeVerifiedMfaChallenge: (...args: unknown[]) => consumeVerifiedMfaChallengeMock(...args),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthUserByTypeAndId: (...args: unknown[]) => getAuthUserByTypeAndIdMock(...args),
}));

vi.mock("@/lib/auth", () => ({
  createSession: (...args: unknown[]) => createSessionMock(...args),
}));

vi.mock("@/lib/invitation-security", () => ({
  getRequestIp: () => "127.0.0.1",
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeDbRateLimit: (...args: unknown[]) => consumeDbRateLimitMock(...args),
}));

describe("POST /api/auth/login/mfa/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeDbRateLimitMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    verifyMfaChallengeMock.mockResolvedValue({ ok: true });
    consumeVerifiedMfaChallengeMock.mockResolvedValue({
      ok: true,
      user: { userType: "provider", userId: "provider-id" },
    });
    getAuthUserByTypeAndIdMock.mockResolvedValue({
      id: "provider-id",
      username: "provider",
      first_name: "Test",
      last_name: "Provider",
      organization_id: "org-id",
      clinic_name: "Clinic",
      clinic_address: null,
      unique_slug: "provider",
    });
    createSessionMock.mockResolvedValue("session-token");
  });

  it("creates session after valid MFA verification", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken: "challenge-token",
          otpCode: "123456",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(verifyMfaChallengeMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid MFA code", async () => {
    verifyMfaChallengeMock.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken: "challenge-token",
          otpCode: "000000",
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("rejects MFA verify when challenge token claims mismatch", async () => {
    verifyMfaChallengeMock.mockResolvedValueOnce({ ok: false, reason: "claim_mismatch" });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken: "challenge-token",
          otpCode: "123456",
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(consumeVerifiedMfaChallengeMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("rejects MFA verify when consume fails after claim validation", async () => {
    consumeVerifiedMfaChallengeMock.mockResolvedValueOnce({ ok: false });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken: "challenge-token",
          otpCode: "123456",
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("returns 429 when verification is rate limited", async () => {
    consumeDbRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 120,
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken: "challenge-token",
          otpCode: "123456",
        }),
      }) as any,
    );

    expect(response.status).toBe(429);
    expect(verifyMfaChallengeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken: "",
          otpCode: "",
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(verifyMfaChallengeMock).not.toHaveBeenCalled();
  });
});
