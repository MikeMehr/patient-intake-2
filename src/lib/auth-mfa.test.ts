import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

describe("auth-mfa backup recovery helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret";
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
});
