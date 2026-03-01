import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeRateLimitMock = vi.hoisted(() => vi.fn());
const createInvitationSessionMock = vi.hoisted(() => vi.fn());
const getInvitationByRawTokenMock = vi.hoisted(() => vi.fn());
const isInvitationOpenableMock = vi.hoisted(() => vi.fn());
const logInvitationAuditMock = vi.hoisted(() => vi.fn());
const verifyOtpForInvitationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/invitation-security", () => ({
  INVITATION_SESSION_COOKIE: "invitation_session",
  consumeRateLimit: (...args: unknown[]) => consumeRateLimitMock(...args),
  createInvitationSession: (...args: unknown[]) => createInvitationSessionMock(...args),
  getInvitationByRawToken: (...args: unknown[]) => getInvitationByRawTokenMock(...args),
  getRequestIp: () => "127.0.0.1",
  isInvitationOpenable: (...args: unknown[]) => isInvitationOpenableMock(...args),
  logInvitationAudit: (...args: unknown[]) => logInvitationAuditMock(...args),
  verifyOtpForInvitation: (...args: unknown[]) => verifyOtpForInvitationMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: () => "req-test",
  logRequestMeta: vi.fn(),
}));

describe("POST /api/invitations/otp/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeRateLimitMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    getInvitationByRawTokenMock.mockResolvedValue({
      invitationId: "invite-1",
      patientName: "Jane Doe",
      patientEmail: "jane@example.com",
      patientDob: "1990-01-01",
      physicianId: "provider-1",
      physicianName: "Dr. Doe",
      clinicName: "Demo Clinic",
      organizationWebsiteUrl: "https://example.org",
    });
    isInvitationOpenableMock.mockResolvedValue(true);
    verifyOtpForInvitationMock.mockResolvedValue({ ok: true });
    createInvitationSessionMock.mockResolvedValue({
      cookieValue: "cookie-value",
      expiresAtMs: Date.now() + 600000,
    });
    logInvitationAuditMock.mockResolvedValue(undefined);
  });

  it("returns 400 when token or otp is missing", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/invitations/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "", otp: "" }),
      }) as any,
    );
    expect(response.status).toBe(400);
    expect(verifyOtpForInvitationMock).not.toHaveBeenCalled();
  });

  it("returns 429 when verification is rate limited", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 45 });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/invitations/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "raw-token", otp: "123456" }),
      }) as any,
    );
    expect(response.status).toBe(429);
    expect(getInvitationByRawTokenMock).not.toHaveBeenCalled();
  });

  it("returns 404 when invitation cannot be opened", async () => {
    getInvitationByRawTokenMock.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/invitations/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "raw-token", otp: "123456" }),
      }) as any,
    );
    expect(response.status).toBe(404);
    expect(verifyOtpForInvitationMock).not.toHaveBeenCalled();
  });

  it("returns 429 on cooldown otp failure", async () => {
    verifyOtpForInvitationMock.mockResolvedValueOnce({ ok: false, reason: "cooldown" });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/invitations/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "raw-token", otp: "123456" }),
      }) as any,
    );
    expect(response.status).toBe(429);
    expect(createInvitationSessionMock).not.toHaveBeenCalled();
  });

  it("creates invitation session and sets cookie on success", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/invitations/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "raw-token", otp: "123456" }),
      }) as any,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(createInvitationSessionMock).toHaveBeenCalledTimes(1);
    expect(response.cookies.get("invitation_session")?.value).toBe("cookie-value");
  });
});

