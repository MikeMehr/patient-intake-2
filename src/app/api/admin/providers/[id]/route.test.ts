import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
const isPasswordContextWordSafeMock = vi.hoisted(() => vi.fn());

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

vi.mock("@/lib/password-context", () => ({
  CONTEXT_PASSWORD_ERROR:
    "Password contains organization or system words and is too easy to guess.",
  isPasswordContextWordSafe: (...args: unknown[]) => isPasswordContextWordSafeMock(...args),
}));

describe("PUT /api/admin/providers/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPasswordContextWordSafeMock.mockReturnValue(true);
    getCurrentSessionMock.mockResolvedValue({
      userId: "sa-1",
      userType: "super_admin",
    });
  });

  it("updates provider mfaEnabled flag", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "provider-1" }] }) // existing provider check
      .mockResolvedValueOnce({ rows: [] }); // update

    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/admin/providers/provider-1", {
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
  });

  it("revokes all provider sessions when password changes", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "provider-1" }] }) // existing provider check
      .mockResolvedValueOnce({ rows: [] }) // update
      .mockResolvedValueOnce({ rows: [] }); // revoke sessions

    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/admin/providers/provider-1", {
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

  it("rejects provider password updates with context words", async () => {
    isPasswordContextWordSafeMock.mockReturnValueOnce(false);
    queryMock.mockResolvedValueOnce({ rows: [{ id: "provider-1" }] }); // existing provider check
    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/admin/providers/provider-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "HealthAssist123!" }),
      }) as any,
      { params: Promise.resolve({ id: "provider-1" }) } as any,
    );

    expect(response.status).toBe(400);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
