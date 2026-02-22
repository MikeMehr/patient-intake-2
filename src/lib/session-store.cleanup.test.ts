import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

describe("session retention cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SESSION_EXPIRY_HOURS;
  });

  it("uses default 30-day retention when env is not set", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 3, rows: [] });
    const { cleanupExpiredSessions } = await import("./session-store");

    const removed = await cleanupExpiredSessions();

    expect(removed).toBe(3);
    expect(queryMock.mock.calls[0][1]).toEqual([720]);
  });

  it("uses configured retention window in hours", async () => {
    process.env.SESSION_EXPIRY_HOURS = "48";
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { cleanupExpiredSessions } = await import("./session-store");

    const removed = await cleanupExpiredSessions();

    expect(removed).toBe(1);
    expect(queryMock.mock.calls[0][1]).toEqual([48]);
  });
});
