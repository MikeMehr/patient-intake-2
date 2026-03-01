import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const verifyPasswordMock = vi.hoisted(() => vi.fn());
const createSessionMock = vi.hoisted(() => vi.fn());
const consumeDbRateLimitMock = vi.hoisted(() => vi.fn());
const clearDbRateLimitMock = vi.hoisted(() => vi.fn());
const issueMfaChallengeMock = vi.hoisted(() => vi.fn());
const getSuperAdminByUsernameMock = vi.hoisted(() => vi.fn());
const getOrgAdminByUsernameMock = vi.hoisted(() => vi.fn());
const getProviderByUsernameMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/auth", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
  createSession: (...args: unknown[]) => createSessionMock(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeDbRateLimit: (...args: unknown[]) => consumeDbRateLimitMock(...args),
  clearDbRateLimit: (...args: unknown[]) => clearDbRateLimitMock(...args),
}));

vi.mock("@/lib/invitation-security", () => ({
  getRequestIp: () => "127.0.0.1",
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: () => "req-test",
  logRequestMeta: vi.fn(),
}));

vi.mock("@/lib/auth-mfa", () => ({
  issueMfaChallenge: (...args: unknown[]) => issueMfaChallengeMock(...args),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getSuperAdminByUsername: (...args: unknown[]) => getSuperAdminByUsernameMock(...args),
  getOrgAdminByUsername: (...args: unknown[]) => getOrgAdminByUsernameMock(...args),
  getProviderByUsername: (...args: unknown[]) => getProviderByUsernameMock(...args),
}));

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeDbRateLimitMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    clearDbRateLimitMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue("token");
    issueMfaChallengeMock.mockResolvedValue({
      challengeToken: "challenge-token",
      expiresInSeconds: 600,
      emailDeliveryEnabled: true,
    });
    getSuperAdminByUsernameMock.mockResolvedValue(null);
    getOrgAdminByUsernameMock.mockResolvedValue(null);
  });

  it("completes login when MFA is disabled", async () => {
    getProviderByUsernameMock.mockResolvedValue({
      id: "provider-id",
      username: "provider",
      first_name: "Test",
      last_name: "Provider",
      organization_id: "org-id",
      clinic_name: "Clinic",
      clinic_address: null,
      unique_slug: "test-provider",
      password_hash: "hash",
      mfa_enabled: false,
    });
    verifyPasswordMock.mockResolvedValue(true);
    queryMock.mockResolvedValue({ rows: [] });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "provider", password: "password" }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(issueMfaChallengeMock).not.toHaveBeenCalled();
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it("returns mfaRequired when MFA is enabled", async () => {
    getProviderByUsernameMock.mockResolvedValue({
      id: "provider-id",
      username: "provider",
      first_name: "Test",
      last_name: "Provider",
      organization_id: "org-id",
      clinic_name: "Clinic",
      clinic_address: null,
      unique_slug: "test-provider",
      email: "provider@example.com",
      password_hash: "hash",
      mfa_enabled: true,
    });
    verifyPasswordMock.mockResolvedValue(true);
    queryMock.mockResolvedValue({ rows: [] });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "provider", password: "password" }),
      }) as any,
    );
    const data = await response.json();

    expect(response.status).toBe(202);
    expect(data.mfaRequired).toBe(true);
    expect(data.mfaPolicy).toEqual({
      allowPstnOtp: false,
      primaryOtpChannels: ["email"],
      recoveryChannels: ["backup_code"],
    });
    expect(issueMfaChallengeMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when username/password are missing", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "", password: "" }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(getSuperAdminByUsernameMock).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid credentials", async () => {
    getProviderByUsernameMock.mockResolvedValue({
      id: "provider-id",
      username: "provider",
      first_name: "Test",
      last_name: "Provider",
      password_hash: "hash",
      mfa_enabled: false,
    });
    verifyPasswordMock.mockResolvedValue(false);
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "provider", password: "bad-password" }),
      }) as any,
    );

    expect(response.status).toBe(401);
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(clearDbRateLimitMock).not.toHaveBeenCalled();
  });

  it("returns 429 when login is rate limited", async () => {
    consumeDbRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 90,
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "provider", password: "password" }),
      }) as any,
    );
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.retryAfterSeconds).toBe(90);
    expect(getSuperAdminByUsernameMock).not.toHaveBeenCalled();
  });

  it("clears login rate-limit bucket after successful auth", async () => {
    getProviderByUsernameMock.mockResolvedValue({
      id: "provider-id",
      username: "provider",
      first_name: "Test",
      last_name: "Provider",
      organization_id: "org-id",
      clinic_name: "Clinic",
      clinic_address: null,
      unique_slug: "test-provider",
      password_hash: "hash",
      mfa_enabled: false,
    });
    verifyPasswordMock.mockResolvedValue(true);
    queryMock.mockResolvedValue({ rows: [] });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "provider", password: "password" }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(clearDbRateLimitMock).toHaveBeenCalledTimes(1);
  });
});
