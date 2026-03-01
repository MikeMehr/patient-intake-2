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

describe("POST /api/org/sessions/terminate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSessionMock.mockResolvedValue({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it("rejects non-org-admin callers", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/org/sessions/terminate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "organization" }),
      }) as any,
    );
    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("terminates all organization sessions", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 4, rows: [] });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/org/sessions/terminate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "organization" }),
      }) as any,
    );
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(String(queryMock.mock.calls[0][0])).toContain("WHERE organization_id = $1");
    expect(queryMock.mock.calls[0][1]).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    expect(data).toEqual({ success: true, scope: "organization", terminatedSessions: 4 });
  });

  it("terminates one user session set within org scope", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/org/sessions/terminate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "user",
          userId: "11111111-1111-4111-8111-111111111111",
        }),
      }) as any,
    );
    expect(response.status).toBe(200);
    expect(String(queryMock.mock.calls[0][0])).toContain("AND user_id = $2");
    expect(queryMock.mock.calls[0][1]).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });
});
