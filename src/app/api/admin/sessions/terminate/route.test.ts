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

describe("POST /api/admin/sessions/terminate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSessionMock.mockResolvedValue({
      userId: "sa-1",
      userType: "super_admin",
    });
  });

  it("rejects non-super-admin callers", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/sessions/terminate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      }) as any,
    );
    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("terminates all active sessions", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 7, rows: [] });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/sessions/terminate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      }) as any,
    );
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(String(queryMock.mock.calls[0][0])).toContain("DELETE FROM physician_sessions");
    expect(data).toEqual({ success: true, scope: "all", terminatedSessions: 7 });
  });

  it("terminates sessions for one user", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 2, rows: [] });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/sessions/terminate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "user",
          userId: "11111111-1111-4111-8111-111111111111",
        }),
      }) as any,
    );
    expect(response.status).toBe(200);
    expect(String(queryMock.mock.calls[0][0])).toContain("WHERE user_id = $1");
    expect(queryMock.mock.calls[0][1]).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("returns 400 for invalid user scope payload", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/sessions/terminate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "user", userId: "not-a-uuid" }),
      }) as any,
    );
    expect(response.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
