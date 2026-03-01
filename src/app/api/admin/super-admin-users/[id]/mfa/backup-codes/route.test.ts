import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
const getBackupCodeStatusMock = vi.hoisted(() => vi.fn());
const generateBackupCodesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/auth-mfa", () => ({
  getBackupCodeStatus: (...args: unknown[]) => getBackupCodeStatusMock(...args),
  generateBackupCodes: (...args: unknown[]) => generateBackupCodesMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("/api/admin/super-admin-users/[id]/mfa/backup-codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSessionMock.mockResolvedValue({ userType: "super_admin", userId: "sa-1" });
  });

  it("rejects non-super-admin callers", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({ userType: "org_admin", userId: "org-1" });
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/super-admin-users/sa-2/mfa/backup-codes") as any,
      { params: Promise.resolve({ id: "sa-2" }) } as any,
    );
    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 404 when target super-admin is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/super-admin-users/sa-2/mfa/backup-codes") as any,
      { params: Promise.resolve({ id: "sa-2" }) } as any,
    );
    expect(response.status).toBe(404);
    expect(getBackupCodeStatusMock).not.toHaveBeenCalled();
  });

  it("returns backup-code status for existing super-admin", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "sa-2" }] });
    getBackupCodeStatusMock.mockResolvedValueOnce({
      activeCodes: 5,
      lastGeneratedAt: "2026-02-26T00:00:00.000Z",
      recoveryVersion: 2,
      backupCodesRequired: false,
      mfaEnabled: true,
      recoveryResetAt: null,
    });
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/super-admin-users/sa-2/mfa/backup-codes") as any,
      { params: Promise.resolve({ id: "sa-2" }) } as any,
    );
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.backupCodes.activeCodes).toBe(5);
  });

  it("returns 409 when generate is requested with active codes", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "sa-2" }] });
    generateBackupCodesMock.mockRejectedValueOnce(new Error("ACTIVE_CODES_EXIST"));
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/super-admin-users/sa-2/mfa/backup-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      }) as any,
      { params: Promise.resolve({ id: "sa-2" }) } as any,
    );
    expect(response.status).toBe(409);
  });
});

