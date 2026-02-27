import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("/api/admin/workforce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSessionMock.mockResolvedValue({ userType: "super_admin", userId: "sa-1" });
  });

  it("returns super-admin and org-admin workforce records", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "sa-1",
            username: "superadmin",
            email: "sa@example.com",
            first_name: "Super",
            last_name: "Admin",
            mfa_enabled: true,
            backup_codes_required: false,
            mfa_recovery_reset_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "ou-1",
            organization_id: "org-1",
            organization_name: "Org One",
            username: "orgadmin",
            email: "oa@example.com",
            first_name: "Org",
            last_name: "Admin",
            mfa_enabled: true,
            backup_codes_required: true,
            mfa_recovery_reset_at: new Date("2026-02-26T00:00:00.000Z"),
          },
        ],
      });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/workforce") as any);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.superAdmins).toHaveLength(1);
    expect(data.orgAdmins).toHaveLength(1);
    expect(data.orgAdmins[0].backupCodesRequired).toBe(true);
  });
});
