import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
const generateBackupCodesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/auth-mfa", () => ({
  getBackupCodeStatus: vi.fn(),
  generateBackupCodes: (...args: unknown[]) => generateBackupCodesMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("/api/admin/organization-users/[id]/mfa/backup-codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSessionMock.mockResolvedValue({ userType: "super_admin", userId: "sa-1" });
  });

  it("rotates backup codes for org-admin account", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "org-user-1" }] });
    generateBackupCodesMock.mockResolvedValueOnce({
      codes: ["AABBCC1122"],
      activeCodes: 1,
      lastGeneratedAt: "2026-02-26T00:00:00.000Z",
      recoveryVersion: 2,
      backupCodesRequired: false,
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/organization-users/org-user-1/mfa/backup-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate" }),
      }) as any,
      { params: Promise.resolve({ id: "org-user-1" }) } as any,
    );
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.backupCodes).toEqual(["AABBCC1122"]);
    expect(data.status.recoveryVersion).toBe(2);
  });
});
