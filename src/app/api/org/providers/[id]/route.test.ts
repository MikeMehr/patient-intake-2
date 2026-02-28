import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
  hashPassword: vi.fn(async () => "hashed-password"),
  validatePassword: vi.fn(() => ({ valid: true })),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

vi.mock("@/lib/password-breach", () => ({
  assessPasswordAgainstBreaches: vi.fn(async () => ({
    breached: false,
    count: 0,
    checked: true,
    failOpen: false,
    unavailable: false,
  })),
  BREACHED_PASSWORD_ERROR:
    "This password has been exposed in known data breaches. Please choose a different password.",
  BREACH_CHECK_UNAVAILABLE_ERROR:
    "Password security check is temporarily unavailable. Please try again in a few minutes.",
}));

describe("PUT /api/org/providers/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSessionMock.mockResolvedValue({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });
  });

  it("updates provider mfaEnabled flag within org scope", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "provider-1", organization_id: "org-1" }] }) // existing provider check
      .mockResolvedValueOnce({ rows: [] }); // update

    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/org/providers/provider-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaEnabled: true }),
      }) as any,
      { params: Promise.resolve({ id: "provider-1" }) } as any,
    );

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(2);
    const [, updateParams] = queryMock.mock.calls[1];
    expect(updateParams[0]).toBe(true);
    expect(updateParams[1]).toBe("provider-1");
    expect(updateParams[2]).toBe("org-1");
  });

  it("rejects non-org-admin users (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
      organizationId: "org-1",
    });

    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/org/providers/provider-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaEnabled: true }),
      }) as any,
      { params: Promise.resolve({ id: "provider-1" }) } as any,
    );

    expect(response.status).toBe(401);
    expect(queryMock).toHaveBeenCalledTimes(0);
  });

  it("returns 404 when provider is outside caller organization (tenant boundary)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // existing provider check constrained by org_id

    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/org/providers/provider-outside-org", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaEnabled: true }),
      }) as any,
      { params: Promise.resolve({ id: "provider-outside-org" }) } as any,
    );

    expect(response.status).toBe(404);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("revokes all provider sessions when password changes", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "provider-1", organization_id: "org-1" }] }) // existing provider check
      .mockResolvedValueOnce({ rows: [] }) // update
      .mockResolvedValueOnce({ rows: [] }); // revoke sessions

    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/org/providers/provider-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "ValidPass123!" }),
      }) as any,
      { params: Promise.resolve({ id: "provider-1" }) } as any,
    );

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(String(queryMock.mock.calls[2][0])).toContain("DELETE FROM physician_sessions");
    expect(queryMock.mock.calls[2][1]).toEqual(["provider-1"]);
  });
});
