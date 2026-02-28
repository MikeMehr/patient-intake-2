import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/patient-phi", () => ({
  decryptPatientPhiString: vi.fn(() => "1234567890"),
  maskHin: vi.fn(() => "***"),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("GET /api/patients/[patientId]", () => {
  const patientId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-provider users (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request(`http://localhost/api/patients/${patientId}`) as any,
      { params: Promise.resolve({ patientId }) } as any,
    );

    expect(response.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 404 when patient is outside provider scope (tenant/object boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { GET } = await import("./route");
    const response = await GET(
      new Request(`http://localhost/api/patients/${patientId}`) as any,
      { params: Promise.resolve({ patientId }) } as any,
    );

    expect(response.status).toBe(404);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
