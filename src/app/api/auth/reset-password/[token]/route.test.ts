import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/auth", () => ({
  hashPassword: vi.fn(async () => "hashed-password"),
  validatePassword: vi.fn(() => ({ valid: true })),
}));

describe("POST /api/auth/reset-password/[token]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret";
  });

  it("accepts a valid token once and marks it used", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ attempt_count: 1, expires_at: new Date(Date.now() + 60_000) }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "reset-token-id",
            physician_id: "11111111-1111-4111-8111-111111111111",
            expires_at: new Date(Date.now() + 60_000),
            used: false,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { POST } = await import("./route");
    const rawToken = "abcdef";

    const response = await POST(
      new Request(`http://localhost/api/auth/reset-password/${rawToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: "ValidPass123!" }),
      }) as any,
      { params: Promise.resolve({ token: rawToken }) } as any,
    );

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(5);
    expect(queryMock.mock.calls[1][1][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(queryMock.mock.calls[1][1][1]).toBe(rawToken);
    expect(queryMock.mock.calls[3][1]).toEqual(["reset-token-id"]);
  });

  it("rejects replay/unknown tokens", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ attempt_count: 1, expires_at: new Date(Date.now() + 60_000) }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/auth/reset-password/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: "ValidPass123!" }),
      }) as any,
      { params: Promise.resolve({ token: "replay" }) } as any,
    );

    expect(response.status).toBe(400);
  });

  it("rejects expired tokens", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ attempt_count: 1, expires_at: new Date(Date.now() + 60_000) }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/auth/reset-password/expired", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: "ValidPass123!" }),
      }) as any,
      { params: Promise.resolve({ token: "expired" }) } as any,
    );

    expect(response.status).toBe(400);
  });
});
