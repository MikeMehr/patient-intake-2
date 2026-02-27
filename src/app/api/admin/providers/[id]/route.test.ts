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

describe("PUT /api/admin/providers/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
