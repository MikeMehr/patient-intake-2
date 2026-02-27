import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("GET /api/auth/ping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes session and returns ok for authenticated user", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
    });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/auth/ping") as any);

    expect(response.status).toBe(200);
    expect(getCurrentSessionMock).toHaveBeenCalledWith({ refresh: true });
  });

  it("returns 401 when no session exists", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/auth/ping") as any);

    expect(response.status).toBe(401);
    expect(getCurrentSessionMock).toHaveBeenCalledWith({ refresh: true });
  });
});
