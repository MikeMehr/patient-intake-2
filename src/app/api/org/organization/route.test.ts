import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const getOrganizationByIdMock = vi.hoisted(() => vi.fn());
const getOrgAdminContextMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getOrganizationById: (...args: unknown[]) => getOrganizationByIdMock(...args),
  getOrgAdminContext: (...args: unknown[]) => getOrgAdminContextMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("GET /api/org/organization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for a provider without the booking grant (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
      organizationId: "org-1",
    });
    getOrgAdminContextMock.mockResolvedValueOnce(null);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/org/organization") as any);

    expect(response.status).toBe(401);
    expect(getOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("serves a provider holding the booking grant, scoped to their own org", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
      organizationId: "org-1",
    });
    getOrgAdminContextMock.mockResolvedValueOnce({
      organizationId: "org-1",
      isOrgAdminAccount: false,
    });
    getOrganizationByIdMock.mockResolvedValueOnce({ id: "org-1", name: "MyMD" });
    queryMock.mockResolvedValueOnce({ rows: [{ slug: "mymd" }] });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/org/organization") as any);

    expect(response.status).toBe(200);
    expect(getOrganizationByIdMock).toHaveBeenCalledWith("org-1");
  });

  it("returns 401 when org admin has no tenant in session (tenant boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: null,
    });
    getOrgAdminContextMock.mockResolvedValueOnce(null);

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
    getOrgAdminContextMock.mockResolvedValueOnce({
      organizationId: "org-1",
      isOrgAdminAccount: true,
    });
    getOrganizationByIdMock.mockResolvedValueOnce(null);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/org/organization") as any);

    expect(response.status).toBe(404);
    expect(getOrganizationByIdMock).toHaveBeenCalledWith("org-1");
  });
});
