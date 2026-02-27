import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const assessPasswordAgainstBreachesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/auth", () => ({
  hashPassword: vi.fn(async () => "hashed-password"),
  validatePassword: vi.fn(() => ({ valid: true })),
}));

vi.mock("@/lib/password-breach", () => ({
  assessPasswordAgainstBreaches: (...args: unknown[]) => assessPasswordAgainstBreachesMock(...args),
  BREACHED_PASSWORD_ERROR:
    "This password has been exposed in known data breaches. Please choose a different password.",
  BREACH_CHECK_UNAVAILABLE_ERROR:
    "Password security check is temporarily unavailable. Please try again in a few minutes.",
}));

describe("POST /api/auth/reset-password/[token]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret";
    assessPasswordAgainstBreachesMock.mockResolvedValue({
      breached: false,
      count: 0,
      checked: true,
      failOpen: false,
      unavailable: false,
    });
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

  it("rejects breached passwords", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ attempt_count: 1, expires_at: new Date(Date.now() + 60_000) }],
    });
    assessPasswordAgainstBreachesMock.mockResolvedValueOnce({
      breached: true,
      count: 12345,
      checked: true,
      failOpen: false,
      unavailable: false,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/reset-password/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: "PwnedPass123!" }),
      }) as any,
      { params: Promise.resolve({ token: "replay" }) } as any,
    );

    expect(response.status).toBe(400);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when breach provider is unavailable in fail-closed mode", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ attempt_count: 1, expires_at: new Date(Date.now() + 60_000) }],
    });
    assessPasswordAgainstBreachesMock.mockResolvedValueOnce({
      breached: false,
      count: 0,
      checked: false,
      failOpen: false,
      unavailable: true,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/reset-password/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: "ValidPass123!" }),
      }) as any,
      { params: Promise.resolve({ token: "replay" }) } as any,
    );

    expect(response.status).toBe(503);
    expect(queryMock).toHaveBeenCalledTimes(1);
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
