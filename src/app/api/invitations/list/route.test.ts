import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
const startInvitationCleanupMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/invitations-cleanup", () => ({
  startInvitationCleanup: (...args: unknown[]) => startInvitationCleanupMock(...args),
}));

describe("GET /api/invitations/list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startInvitationCleanupMock.mockReturnValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(401);
    expect(queryMock).toHaveBeenCalledTimes(0);
  });

  it("returns 403 for non-provider users (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(403);
    expect(queryMock).toHaveBeenCalledTimes(0);
  });

  it("queries invitations scoped to the authenticated provider (object boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
      organizationId: "org-1",
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual(["provider-1"]);
  });
});
