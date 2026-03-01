import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const cookiesMock = vi.hoisted(() => vi.fn());
const cookieGetMock = vi.hoisted(() => vi.fn());
const cookieSetMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => cookiesMock(...args),
}));

describe("auth session lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret";
    cookiesMock.mockResolvedValue({
      get: (...args: unknown[]) => cookieGetMock(...args),
      set: (...args: unknown[]) => cookieSetMock(...args),
    });
  });

  it("rotates session token on refresh", async () => {
    cookieGetMock.mockReturnValue({ value: "old-token" });
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          user_id: "provider-1",
          user_type: "provider",
          organization_id: "org-1",
          physician_id: "provider-1",
          expires_at: new Date(Date.now() + 5 * 60 * 1000),
          created_at: new Date(Date.now() - 5 * 60 * 1000),
          session_data: {
            userId: "provider-1",
            userType: "provider",
            username: "doctor1",
            firstName: "Doc",
            lastName: "Tor",
            expiresAt: Date.now() + 5 * 60 * 1000,
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const { getCurrentSession } = await import("./auth");
    const session = await getCurrentSession({ refresh: true });

    expect(session?.userId).toBe("provider-1");
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(String(queryMock.mock.calls[1][0])).toContain("SET token = $1");
    expect(queryMock.mock.calls[1][1][3]).toBe("old-token");
    expect(cookieSetMock).toHaveBeenCalledTimes(1);
    const [cookieName, rotatedToken] = cookieSetMock.mock.calls[0];
    expect(cookieName).toBe("physician_session");
    expect(rotatedToken).toMatch(/^[a-f0-9]{64}$/);
    expect(rotatedToken).not.toBe("old-token");
  });

  it("caps concurrent sessions per account when creating a new session", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // prune older sessions
      .mockResolvedValueOnce({ rows: [] }); // insert new session

    const { createSession } = await import("./auth");
    await createSession(
      "provider-1",
      "provider",
      "doctor1",
      "Doc",
      "Tor",
      "org-1",
      "Clinic",
      null,
    );

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(String(queryMock.mock.calls[0][0])).toContain("OFFSET $2");
    expect(queryMock.mock.calls[0][1]).toEqual(["provider-1", 2]);
    expect(String(queryMock.mock.calls[1][0])).toContain("INSERT INTO physician_sessions");
    expect(cookieSetMock).toHaveBeenCalledWith(
      "physician_session",
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("does not set a new cookie when refresh rotation update matches no rows", async () => {
    cookieGetMock.mockReturnValue({ value: "stale-token" });
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          user_id: "provider-1",
          user_type: "provider",
          organization_id: "org-1",
          physician_id: "provider-1",
          expires_at: new Date(Date.now() + 5 * 60 * 1000),
          created_at: new Date(Date.now() - 5 * 60 * 1000),
          session_data: {
            userId: "provider-1",
            userType: "provider",
            username: "doctor1",
            firstName: "Doc",
            lastName: "Tor",
            expiresAt: Date.now() + 5 * 60 * 1000,
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const { getCurrentSession } = await import("./auth");
    const session = await getCurrentSession({ refresh: true });

    expect(session?.userId).toBe("provider-1");
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(cookieSetMock).toHaveBeenCalledTimes(0);
  });

  it("invalidates expired sessions in verifySession", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          user_id: "provider-1",
          user_type: "provider",
          organization_id: "org-1",
          physician_id: "provider-1",
          expires_at: new Date(Date.now() - 1_000),
          created_at: new Date(),
          session_data: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const { verifySession } = await import("./auth");
    const session = await verifySession("expired-token");

    expect(session).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(String(queryMock.mock.calls[1][0])).toContain("DELETE FROM physician_sessions");
  });

  it("invalidates sessions beyond absolute max in getCurrentSession", async () => {
    cookieGetMock.mockReturnValue({ value: "abs-token" });
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          user_id: "provider-1",
          user_type: "provider",
          organization_id: "org-1",
          physician_id: "provider-1",
          expires_at: new Date(Date.now() + 60 * 1000),
          created_at: new Date(Date.now() - (5 * 60 * 60 * 1000)),
          session_data: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const { getCurrentSession } = await import("./auth");
    const session = await getCurrentSession();

    expect(session).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(String(queryMock.mock.calls[1][0])).toContain("DELETE FROM physician_sessions");
    expect(cookieSetMock).toHaveBeenCalledWith(
      "physician_session",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });

  it("clears cookie when token has no backing session row", async () => {
    cookieGetMock.mockReturnValue({ value: "missing-token" });
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { getCurrentSession } = await import("./auth");
    const session = await getCurrentSession();

    expect(session).toBeNull();
    expect(cookieSetMock).toHaveBeenCalledWith(
      "physician_session",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });

  it("accepts previous token during short rotation grace window", async () => {
    cookieGetMock.mockReturnValue({ value: "old-token" });
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // direct token lookup miss
      .mockResolvedValueOnce({
        rows: [{
          user_id: "provider-1",
          user_type: "provider",
          organization_id: "org-1",
          physician_id: "provider-1",
          expires_at: new Date(Date.now() + 5 * 60 * 1000),
          created_at: new Date(Date.now() - 5 * 60 * 1000),
          session_data: {
            userId: "provider-1",
            userType: "provider",
            username: "doctor1",
            firstName: "Doc",
            lastName: "Tor",
            expiresAt: Date.now() + 5 * 60 * 1000,
            previousToken: "old-token",
            previousTokenGraceUntil: Date.now() + 10_000,
          },
        }],
      });

    const { getCurrentSession } = await import("./auth");
    const session = await getCurrentSession();

    expect(session?.userId).toBe("provider-1");
    expect(cookieSetMock).toHaveBeenCalledTimes(0);
  });
});
