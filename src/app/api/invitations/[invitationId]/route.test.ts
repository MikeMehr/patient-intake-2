import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

describe("DELETE /api/invitations/[invitationId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);

    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost/api/invitations/inv-1") as any, {
      params: Promise.resolve({ invitationId: "inv-1" }),
    });

    expect(response.status).toBe(401);
    expect(queryMock).toHaveBeenCalledTimes(0);
  });

  it("returns 403 for non-provider users (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });

    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost/api/invitations/inv-1") as any, {
      params: Promise.resolve({ invitationId: "inv-1" }),
    });

    expect(response.status).toBe(403);
    expect(queryMock).toHaveBeenCalledTimes(0);
  });

  it("returns 404 when provider attempts deleting another provider invitation (object boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
      organizationId: "org-1",
    });
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost/api/invitations/inv-other-provider") as any, {
      params: Promise.resolve({ invitationId: "inv-other-provider" }),
    });

    expect(response.status).toBe(404);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual(["inv-other-provider", "provider-1"]);
  });
});
