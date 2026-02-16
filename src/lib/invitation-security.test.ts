import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

describe("invitation-security helpers", () => {
  beforeEach(() => {
    queryMock.mockReset();
    process.env.SESSION_SECRET = "test-session-secret";
  });

  it("generates token and OTP in expected formats", async () => {
    const mod = await import("@/lib/invitation-security");
    const token = mod.createInvitationToken();
    const otp = mod.createOtpCode();

    expect(token.rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("marks OTP as invalid and increments attempts", async () => {
    const mod = await import("@/lib/invitation-security");
    const future = new Date(Date.now() + 60_000);
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-1",
            otp_hash: mod.hashValue("123456"),
            expires_at: future,
            attempt_count: 0,
            max_attempts: 5,
            cooldown_until: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await mod.verifyOtpForInvitation({
      invitationId: "invite-1",
      otpCode: "654321",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid");
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("accepts valid OTP and marks challenge verified", async () => {
    const mod = await import("@/lib/invitation-security");
    const future = new Date(Date.now() + 60_000);
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-2",
            otp_hash: mod.hashValue("222222"),
            expires_at: future,
            attempt_count: 0,
            max_attempts: 5,
            cooldown_until: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await mod.verifyOtpForInvitation({
      invitationId: "invite-2",
      otpCode: "222222",
    });

    expect(result.ok).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("returns blocked rate-limit result when bucket exceeds cap", async () => {
    const mod = await import("@/lib/invitation-security");
    queryMock.mockResolvedValueOnce({
      rows: [{ attempt_count: 11, expires_at: new Date(Date.now() + 45_000) }],
    });

    const result = await mod.consumeRateLimit("bucket-1", 10, 60);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("builds signed invitation session cookie payload", async () => {
    const mod = await import("@/lib/invitation-security");
    const cookieValue = mod.createInvitationSessionCookie({
      invitationId: "invite-123",
      sessionToken: "session-token-abc",
      expiresAtEpochMs: Date.now() + 60_000,
    });

    const parts = cookieValue.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(10);
    expect(parts[1].length).toBeGreaterThan(10);
  });
});
