import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret";
  });

  it("stores token hash (not raw token) for new reset requests", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ attempt_count: 1, expires_at: new Date(Date.now() + 60_000) }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "11111111-1111-4111-8111-111111111111", email: "doctor@example.com" }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "doctor@example.com" }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(3);

    const [, insertParams] = queryMock.mock.calls[2];
    expect(insertParams[0]).toBe("11111111-1111-4111-8111-111111111111");
    expect(insertParams[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(insertParams[2]).toBeInstanceOf(Date);
  });
});
