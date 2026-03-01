import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const validatePasswordMock = vi.hoisted(() => vi.fn());
const hashPasswordMock = vi.hoisted(() => vi.fn());
const assessPasswordAgainstBreachesMock = vi.hoisted(() => vi.fn());
const consumeDbRateLimitMock = vi.hoisted(() => vi.fn());
const isPasswordContextWordSafeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/auth", () => ({
  validatePassword: (...args: unknown[]) => validatePasswordMock(...args),
  hashPassword: (...args: unknown[]) => hashPasswordMock(...args),
}));

vi.mock("@/lib/password-breach", () => ({
  assessPasswordAgainstBreaches: (...args: unknown[]) => assessPasswordAgainstBreachesMock(...args),
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

vi.mock("@/lib/rate-limit", () => ({
  consumeDbRateLimit: (...args: unknown[]) => consumeDbRateLimitMock(...args),
}));

vi.mock("@/lib/invitation-security", () => ({
  getRequestIp: () => "127.0.0.1",
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: () => "req-test",
  logRequestMeta: vi.fn(),
}));

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_ALLOW_SELF_REGISTER = "true";

    validatePasswordMock.mockReturnValue({ valid: true });
    hashPasswordMock.mockResolvedValue("hashed-password");
    assessPasswordAgainstBreachesMock.mockResolvedValue({
      breached: false,
      count: 0,
      checked: true,
      failOpen: false,
      unavailable: false,
    });
    consumeDbRateLimitMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    isPasswordContextWordSafeMock.mockReturnValue(true);
  });

  it("accepts registration when password is not breached", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // username check
      .mockResolvedValueOnce({ rows: [] }) // email check
      .mockResolvedValueOnce({ rows: [] }) // slug check
      .mockResolvedValueOnce({ rows: [{ id: "new-physician-id" }] }); // insert

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: "Test",
          lastName: "Doctor",
          clinicName: "Demo Clinic",
          username: "testdoc",
          password: "ValidPass123!",
          email: "doc@example.com",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(assessPasswordAgainstBreachesMock).toHaveBeenCalledWith("ValidPass123!");
    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it("rejects breached passwords", async () => {
    assessPasswordAgainstBreachesMock.mockResolvedValueOnce({
      breached: true,
      count: 9000,
      checked: true,
      failOpen: false,
      unavailable: false,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: "Test",
          lastName: "Doctor",
          clinicName: "Demo Clinic",
          username: "testdoc",
          password: "PwnedPass123!",
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(queryMock).toHaveBeenCalledTimes(0);
  });

  it("returns 503 when breach provider is unavailable in fail-closed mode", async () => {
    assessPasswordAgainstBreachesMock.mockResolvedValueOnce({
      breached: false,
      count: 0,
      checked: false,
      failOpen: false,
      unavailable: true,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: "Test",
          lastName: "Doctor",
          clinicName: "Demo Clinic",
          username: "testdoc",
          password: "ValidPass123!",
        }),
      }) as any,
    );

    expect(response.status).toBe(503);
    expect(queryMock).toHaveBeenCalledTimes(0);
  });

  it("rejects passwords containing context words", async () => {
    isPasswordContextWordSafeMock.mockReturnValueOnce(false);
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: "Test",
          lastName: "Doctor",
          clinicName: "Demo Clinic",
          username: "testdoc",
          password: "HealthAssist123!",
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(assessPasswordAgainstBreachesMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(0);
  });
});

