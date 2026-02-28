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

describe("/api/admin/organizations/[id] authorization boundaries", () => {
  const organizationId = "org-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for non-super-admin users (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "provider-1",
      userType: "provider",
      organizationId: "org-1",
    });

    const { GET, PUT, DELETE } = await import("./route");

    const getResponse = await GET(
      new Request(`http://localhost/api/admin/organizations/${organizationId}`) as any,
      { params: Promise.resolve({ id: organizationId }) } as any,
    );
    const putResponse = await PUT(
      new Request(`http://localhost/api/admin/organizations/${organizationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Org",
          email: "org@example.com",
          businessAddress: "123 Test St",
          isActive: true,
        }),
      }) as any,
      { params: Promise.resolve({ id: organizationId }) } as any,
    );
    const deleteResponse = await DELETE(
      new Request(`http://localhost/api/admin/organizations/${organizationId}`, {
        method: "DELETE",
      }) as any,
      { params: Promise.resolve({ id: organizationId }) } as any,
    );

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
    expect(deleteResponse.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 404 for nonexistent organization ids (object boundary)", async () => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "sa-1",
      userType: "super_admin",
    });

    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] }) // GET column check
      .mockResolvedValueOnce({ rows: [] }) // GET org lookup
      .mockResolvedValueOnce({ rows: [{ exists: true }] }) // PUT column check
      .mockResolvedValueOnce({ rows: [] }) // PUT org existence check
      .mockResolvedValueOnce({ rows: [] }); // DELETE org existence check

    const { GET, PUT, DELETE } = await import("./route");

    const getResponse = await GET(
      new Request(`http://localhost/api/admin/organizations/${organizationId}`) as any,
      { params: Promise.resolve({ id: organizationId }) } as any,
    );
    const putResponse = await PUT(
      new Request(`http://localhost/api/admin/organizations/${organizationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Org",
          email: "org@example.com",
          businessAddress: "123 Test St",
          isActive: true,
        }),
      }) as any,
      { params: Promise.resolve({ id: organizationId }) } as any,
    );
    const deleteResponse = await DELETE(
      new Request(`http://localhost/api/admin/organizations/${organizationId}`, {
        method: "DELETE",
      }) as any,
      { params: Promise.resolve({ id: organizationId }) } as any,
    );

    expect(getResponse.status).toBe(404);
    expect(putResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(404);
  });
});
