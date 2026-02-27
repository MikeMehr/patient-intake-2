import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteSessionMock = vi.hoisted(() => vi.fn());
const cookiesMock = vi.hoisted(() => vi.fn());
const cookieGetMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
}));

vi.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => cookiesMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue({
      get: (...args: unknown[]) => cookieGetMock(...args),
    });
  });

  it("deletes session when cookie token is present", async () => {
    cookieGetMock.mockReturnValue({ value: "session-token-1" });
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/auth/logout", {
      method: "POST",
    }) as any);

    expect(response.status).toBe(200);
    expect(deleteSessionMock).toHaveBeenCalledWith("session-token-1");
  });

  it("returns success even when no cookie token exists", async () => {
    cookieGetMock.mockReturnValue(undefined);
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/auth/logout", {
      method: "POST",
    }) as any);

    expect(response.status).toBe(200);
    expect(deleteSessionMock).not.toHaveBeenCalled();
  });
});
