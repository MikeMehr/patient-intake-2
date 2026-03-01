import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

describe("auth-mfa backup recovery helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.TOKEN_ISSUER = "issuer-test";
    process.env.TOKEN_AUDIENCE = "audience-test";
  });

  it("returns backup code status summary", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        mfa_enabled: true,
        mfa_recovery_version: 2,
        backup_codes_required: false,
        mfa_recovery_reset_at: null,
      }],
    });
    queryMock.mockResolvedValueOnce({
      rows: [{ active_codes: 3, last_generated_at: new Date("2026-02-01T00:00:00.000Z") }],
    });
    const { getBackupCodeStatus } = await import("./auth-mfa");
    const status = await getBackupCodeStatus({
      userType: "provider",
      userId: "provider-1",
    });
    expect(status.activeCodes).toBe(3);
    expect(status.lastGeneratedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(status.recoveryVersion).toBe(2);
    expect(status.backupCodesRequired).toBe(false);
  });

  it("blocks generate when active codes already exist and rotate is false", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        mfa_enabled: true,
        mfa_recovery_version: 1,
        backup_codes_required: false,
        mfa_recovery_reset_at: null,
      }],
    });
    queryMock.mockResolvedValueOnce({
      rows: [{ active_codes: 2, last_generated_at: new Date("2026-02-01T00:00:00.000Z") }],
    });
    const { generateBackupCodes } = await import("./auth-mfa");
    await expect(
      generateBackupCodes({
        userType: "provider",
        userId: "provider-1",
        rotateExisting: false,
      }),
    ).rejects.toThrow("ACTIVE_CODES_EXIST");
  });

  it("rejects invalid backup recovery code for challenge", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-1",
            user_type: "provider",
            user_id: "provider-1",
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null,
            token_iss: "issuer-test",
            token_aud: "audience-test",
            token_type: "mfa_challenge",
            token_context: "auth_login_mfa",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          mfa_enabled: true,
          mfa_recovery_version: 3,
          backup_codes_required: false,
          mfa_recovery_reset_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const { consumeBackupCodeForChallenge } = await import("./auth-mfa");
    const result = await consumeBackupCodeForChallenge({
      challengeToken: "challenge-token",
      backupCode: "INVALID",
      purpose: "login",
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects backup recovery while regeneration is required", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-1",
            user_type: "provider",
            user_id: "provider-1",
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null,
            token_iss: "issuer-test",
            token_aud: "audience-test",
            token_type: "mfa_challenge",
            token_context: "auth_login_mfa",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          mfa_enabled: true,
          mfa_recovery_version: 4,
          backup_codes_required: true,
          mfa_recovery_reset_at: new Date("2026-02-02T00:00:00.000Z"),
        }],
      });
    const { consumeBackupCodeForChallenge } = await import("./auth-mfa");
    const result = await consumeBackupCodeForChallenge({
      challengeToken: "challenge-token",
      backupCode: "ABCDEF",
      purpose: "login",
    });
    expect(result).toEqual({ ok: false, reason: "codes_required" });
  });

  it("rejects MFA verify when token claims mismatch", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "challenge-claims",
          user_type: "provider",
          user_id: "provider-1",
          otp_hash: "abc",
          expires_at: new Date(Date.now() + 60_000),
          attempt_count: 0,
          max_attempts: 5,
          cooldown_until: null,
          context_token_hash: null,
          token_iss: "issuer-test",
          token_aud: "wrong-audience",
          token_type: "mfa_challenge",
          token_context: "auth_login_mfa",
        },
      ],
    });

    const { verifyMfaChallenge } = await import("./auth-mfa");
    const result = await verifyMfaChallenge({
      challengeToken: "challenge-token",
      otpCode: "123456",
      purpose: "login",
    });
    expect(result).toEqual({ ok: false, reason: "claim_mismatch" });
  });

  it.each([
    { field: "token_iss", value: "wrong-issuer" },
    { field: "token_aud", value: "wrong-audience" },
    { field: "token_type", value: "wrong-type" },
    { field: "token_context", value: "wrong-context" },
  ])("rejects MFA verify when $field mismatches", async ({ field, value }) => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "challenge-claims-field",
          user_type: "provider",
          user_id: "provider-1",
          otp_hash: "abc",
          expires_at: new Date(Date.now() + 60_000),
          attempt_count: 0,
          max_attempts: 5,
          cooldown_until: null,
          context_token_hash: null,
          token_iss: "issuer-test",
          token_aud: "audience-test",
          token_type: "mfa_challenge",
          token_context: "auth_login_mfa",
          [field]: value,
        },
      ],
    });

    const { verifyMfaChallenge } = await import("./auth-mfa");
    const result = await verifyMfaChallenge({
      challengeToken: "challenge-token",
      otpCode: "123456",
      purpose: "login",
    });
    expect(result).toEqual({ ok: false, reason: "claim_mismatch" });
  });

  it("rejects MFA consume when token claims mismatch", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "challenge-claims-consume",
          user_type: "provider",
          user_id: "provider-1",
          verified_at: new Date(Date.now() - 1_000),
          consumed_at: null,
          expires_at: new Date(Date.now() + 60_000),
          context_token_hash: null,
          token_iss: "wrong-issuer",
          token_aud: "audience-test",
          token_type: "mfa_challenge",
          token_context: "auth_login_mfa",
        },
      ],
    });

    const { consumeVerifiedMfaChallenge } = await import("./auth-mfa");
    const result = await consumeVerifiedMfaChallenge({
      challengeToken: "challenge-token",
      purpose: "login",
    });
    expect(result).toEqual({ ok: false });
  });

  it.each([
    { field: "token_iss", value: "wrong-issuer" },
    { field: "token_aud", value: "wrong-audience" },
    { field: "token_type", value: "wrong-type" },
    { field: "token_context", value: "wrong-context" },
  ])("rejects MFA consume when $field mismatches", async ({ field, value }) => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "challenge-claims-consume-field",
          user_type: "provider",
          user_id: "provider-1",
          verified_at: new Date(Date.now() - 1_000),
          consumed_at: null,
          expires_at: new Date(Date.now() + 60_000),
          context_token_hash: null,
          token_iss: "issuer-test",
          token_aud: "audience-test",
          token_type: "mfa_challenge",
          token_context: "auth_login_mfa",
          [field]: value,
        },
      ],
    });

    const { consumeVerifiedMfaChallenge } = await import("./auth-mfa");
    const result = await consumeVerifiedMfaChallenge({
      challengeToken: "challenge-token",
      purpose: "login",
    });
    expect(result).toEqual({ ok: false });
  });

  it("stores expected claims when issuing MFA challenge", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const { issueMfaChallenge } = await import("./auth-mfa");

    await issueMfaChallenge({
      user: { userType: "provider", userId: "provider-1", email: null },
      purpose: "login",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(String(queryMock.mock.calls[1]?.[0] || "")).toContain("token_iss");
    expect(queryMock.mock.calls[1]?.[1]?.slice(10, 14)).toEqual([
      "issuer-test",
      "audience-test",
      "mfa_challenge",
      "auth_login_mfa",
    ]);
  });
});
