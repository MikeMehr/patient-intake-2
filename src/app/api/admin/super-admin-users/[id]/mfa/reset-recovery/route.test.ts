import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
const adminResetMfaRecoveryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/auth-mfa", () => ({
  adminResetMfaRecovery: (...args: unknown[]) => adminResetMfaRecoveryMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("/api/admin/super-admin-users/[id]/mfa/reset-recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSessionMock.mockResolvedValue({ userType: "super_admin", userId: "sa-1" });
  });

  it("resets recovery state and keeps mfa enabled", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "sa-2" }] });
    adminResetMfaRecoveryMock.mockResolvedValueOnce({
      mfaEnabled: true,
      recoveryVersion: 3,
      backupCodesRequired: true,
      recoveryResetAt: "2026-02-26T00:00:00.000Z",
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/super-admin-users/sa-2/mfa/reset-recovery", {
        method: "POST",
      }) as any,
      { params: Promise.resolve({ id: "sa-2" }) } as any,
    );
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.recovery.mfaEnabled).toBe(true);
    expect(data.recovery.backupCodesRequired).toBe(true);
  });
});
