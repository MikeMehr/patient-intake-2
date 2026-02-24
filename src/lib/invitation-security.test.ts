import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

describe("invitation-security helpers", () => {
  beforeEach(() => {
    queryMock.mockReset();
    process.env.SESSION_SECRET = "test-session-secret";
  });

  it("generates token and OTP in expected formats", async () => {
    const mod = await import("@/lib/invitation-security");
    const token = mod.createInvitationToken();
    const otp = mod.createOtpCode();

    expect(token.rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("marks OTP as invalid and increments attempts", async () => {
    const mod = await import("@/lib/invitation-security");
    const future = new Date(Date.now() + 60_000);
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-1",
            otp_hash: mod.hashValue("123456"),
            expires_at: future,
            attempt_count: 0,
            max_attempts: 5,
            cooldown_until: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await mod.verifyOtpForInvitation({
      invitationId: "invite-1",
      otpCode: "654321",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid");
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("accepts valid OTP and marks challenge verified", async () => {
    const mod = await import("@/lib/invitation-security");
    const future = new Date(Date.now() + 60_000);
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-2",
            otp_hash: mod.hashValue("222222"),
            expires_at: future,
            attempt_count: 0,
            max_attempts: 5,
            cooldown_until: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await mod.verifyOtpForInvitation({
      invitationId: "invite-2",
      otpCode: "222222",
    });

    expect(result.ok).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("returns blocked rate-limit result when bucket exceeds cap", async () => {
    const mod = await import("@/lib/invitation-security");
    queryMock.mockResolvedValueOnce({
      rows: [{ attempt_count: 11, expires_at: new Date(Date.now() + 45_000) }],
    });

    const result = await mod.consumeRateLimit("bucket-1", 10, 60);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("builds signed invitation session cookie payload", async () => {
    const mod = await import("@/lib/invitation-security");
    const cookieValue = mod.createInvitationSessionCookie({
      invitationId: "invite-123",
      sessionToken: "session-token-abc",
      expiresAtEpochMs: Date.now() + 60_000,
    });

    const parts = cookieValue.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(10);
    expect(parts[1].length).toBeGreaterThan(10);
  });

  it("hides summaries when summary TTL is expired", async () => {
    const mod = await import("@/lib/invitation-security");
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "invite-ttl",
          physician_id: "physician-1",
          patient_email: "patient@example.com",
          patient_name: "Pat Ient",
          oscar_demographic_no: null,
          token_expires_at: new Date(Date.now() + 60_000),
          used_at: null,
          revoked_at: null,
          expires_at: new Date(Date.now() + 60_000),
          lab_report_summary: "Current lab summary",
          previous_lab_report_summary: "Previous lab summary",
          form_summary: "Form summary",
          summary_expires_at: new Date(Date.now() - 60_000),
          summary_deleted_at: null,
          patient_background: null,
          interview_guidance: null,
          first_name: "Test",
          last_name: "Doctor",
          clinic_name: "Clinic",
        },
      ],
    });

    const invite = await mod.getInvitationByRawToken("raw-token");
    expect(invite).not.toBeNull();
    expect(invite?.labReportSummary).toBeNull();
    expect(invite?.previousLabReportSummary).toBeNull();
    expect(invite?.formSummary).toBeNull();
  });

  it("clears expired invitation summaries through purge helper", async () => {
    const mod = await import("@/lib/invitation-security");
    queryMock.mockResolvedValueOnce({ rowCount: 2, rows: [] });

    const count = await mod.clearExpiredInvitationSummaries();
    expect(count).toBe(2);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = String(queryMock.mock.calls[0]?.[0] || "");
    expect(sql).toContain("summary_expires_at <= NOW()");
    expect(sql).toContain("summary_deleted_at = COALESCE(summary_deleted_at, NOW())");
  });

  it("clears summaries immediately for invitation completion", async () => {
    const mod = await import("@/lib/invitation-security");
    queryMock.mockResolvedValueOnce({ rows: [] });

    await mod.clearInvitationSummaries("invite-id-123");
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("SET lab_report_summary = NULL"),
      ["invite-id-123"],
    );
  });
});
