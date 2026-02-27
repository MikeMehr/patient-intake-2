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

describe("/api/org/providers/[id]/mfa/backup-codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSessionMock.mockResolvedValue({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });
  });

  it("returns backup code status for provider in same org", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "provider-1" }] });
    getBackupCodeStatusMock.mockResolvedValueOnce({
      activeCodes: 4,
      lastGeneratedAt: "2026-01-01T00:00:00.000Z",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/org/providers/provider-1/mfa/backup-codes") as any,
      { params: Promise.resolve({ id: "provider-1" }) } as any,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.backupCodes.activeCodes).toBe(4);
  });

  it("rotates backup codes", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "provider-1" }] });
    generateBackupCodesMock.mockResolvedValueOnce({
      codes: ["ROTATE1111", "ROTATE2222"],
      activeCodes: 2,
      lastGeneratedAt: "2026-01-01T00:00:00.000Z",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/org/providers/provider-1/mfa/backup-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate" }),
      }) as any,
      { params: Promise.resolve({ id: "provider-1" }) } as any,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.backupCodes).toEqual(["ROTATE1111", "ROTATE2222"]);
  });
});
