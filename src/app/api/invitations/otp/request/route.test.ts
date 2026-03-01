import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeRateLimitMock = vi.hoisted(() => vi.fn());
const createOtpCodeMock = vi.hoisted(() => vi.fn());
const getInvitationByRawTokenMock = vi.hoisted(() => vi.fn());
const isInvitationOpenableMock = vi.hoisted(() => vi.fn());
const logInvitationAuditMock = vi.hoisted(() => vi.fn());
const upsertOtpChallengeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/invitation-security", () => ({
  consumeRateLimit: (...args: unknown[]) => consumeRateLimitMock(...args),
  createOtpCode: (...args: unknown[]) => createOtpCodeMock(...args),
  getInvitationByRawToken: (...args: unknown[]) => getInvitationByRawTokenMock(...args),
  getRequestIp: () => "127.0.0.1",
  isInvitationOpenable: (...args: unknown[]) => isInvitationOpenableMock(...args),
  logInvitationAudit: (...args: unknown[]) => logInvitationAuditMock(...args),
  upsertOtpChallenge: (...args: unknown[]) => upsertOtpChallengeMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: () => "req-test",
  logRequestMeta: vi.fn(),
}));

describe("POST /api/invitations/otp/request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeRateLimitMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    createOtpCodeMock.mockReturnValue("123456");
    getInvitationByRawTokenMock.mockResolvedValue({
      invitationId: "invite-1",
      patientEmail: "patient@example.com",
      clinicName: "Demo Clinic",
    });
    isInvitationOpenableMock.mockResolvedValue(true);
    upsertOtpChallengeMock.mockResolvedValue(undefined);
    logInvitationAuditMock.mockResolvedValue(undefined);
  });

  it("returns 400 when token is missing", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/invitations/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "" }),
      }) as any,
    );
    expect(response.status).toBe(400);
    expect(consumeRateLimitMock).not.toHaveBeenCalled();
  });

  it("returns 429 when request is rate limited", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/invitations/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "raw-token" }),
      }) as any,
    );
    expect(response.status).toBe(429);
    expect(getInvitationByRawTokenMock).not.toHaveBeenCalled();
  });

  it("returns 404 for invalid or closed invitation", async () => {
    getInvitationByRawTokenMock.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/invitations/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "raw-token" }),
      }) as any,
    );
    expect(response.status).toBe(404);
    expect(upsertOtpChallengeMock).not.toHaveBeenCalled();
  });

  it("issues otp challenge and records audit", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/invitations/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "raw-token" }),
      }) as any,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(upsertOtpChallengeMock).toHaveBeenCalledWith("invite-1", "123456");
    expect(logInvitationAuditMock).toHaveBeenCalledTimes(1);
  });
});

