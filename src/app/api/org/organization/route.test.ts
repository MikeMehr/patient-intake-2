import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const getOrganizationByIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getOrganizationById: (...args: unknown[]) => getOrganizationByIdMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("GET /api/org/organization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for non-org-admin sessions (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
      organizationId: "org-1",
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/org/organization") as any);

    expect(response.status).toBe(401);
    expect(getOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("returns 401 when org admin has no tenant in session (tenant boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: null,
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/org/organization") as any);

    expect(response.status).toBe(401);
    expect(getOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 when organization record no longer exists (object boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });
    getOrganizationByIdMock.mockResolvedValueOnce(null);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/org/organization") as any);

    expect(response.status).toBe(404);
    expect(getOrganizationByIdMock).toHaveBeenCalledWith("org-1");
  });
});
