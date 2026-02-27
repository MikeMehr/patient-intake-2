import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeBackupCodeForChallengeMock = vi.hoisted(() => vi.fn());
const getAuthUserByTypeAndIdMock = vi.hoisted(() => vi.fn());
const createSessionMock = vi.hoisted(() => vi.fn());
const consumeDbRateLimitMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-mfa", () => ({
  consumeBackupCodeForChallenge: (...args: unknown[]) => consumeBackupCodeForChallengeMock(...args),
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

describe("POST /api/auth/login/mfa/recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeDbRateLimitMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    consumeBackupCodeForChallengeMock.mockResolvedValue({
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

  it("creates session after valid recovery code", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login/mfa/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken: "challenge-token",
          backupCode: "ABCD1234",
        }),
      }) as any,
    );
    expect(response.status).toBe(200);
    expect(consumeBackupCodeForChallengeMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid recovery code", async () => {
    consumeBackupCodeForChallengeMock.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/login/mfa/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken: "challenge-token",
          backupCode: "INVALID",
        }),
      }) as any,
    );
    expect(response.status).toBe(400);
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
