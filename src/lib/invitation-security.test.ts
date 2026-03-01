import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

const queryMock = vi.fn();
const cookiesMock = vi.fn();
const headersMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => cookiesMock(...args),
  headers: (...args: unknown[]) => headersMock(...args),
}));

describe("invitation-security helpers", () => {
  beforeEach(() => {
    queryMock.mockReset();
    cookiesMock.mockReset();
    headersMock.mockReset();
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.TOKEN_ISSUER = "issuer-test";
    process.env.TOKEN_AUDIENCE = "health-assist-app";
    headersMock.mockResolvedValue({ get: () => "" });
    cookiesMock.mockResolvedValue({ get: () => undefined });
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

  it("rejects invitation session cookie when signature is tampered", async () => {
    const mod = await import("@/lib/invitation-security");
    const cookieValue = mod.createInvitationSessionCookie({
      invitationId: "invite-tamper-sig",
      sessionToken: "session-token-tamper-sig",
      expiresAtEpochMs: Date.now() + 60_000,
    });
    const [payload, signature] = cookieValue.split(".");
    const tampered = `${payload}.${signature.slice(0, -1)}x`;

    cookiesMock.mockResolvedValue({ get: () => ({ value: tampered }) });
    queryMock.mockResolvedValueOnce({ rows: [{ exists: false }] });

    const resolved = await mod.resolveInvitationFromCookie();
    expect(resolved).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invitation session cookie when payload is expired", async () => {
    const mod = await import("@/lib/invitation-security");
    const cookieValue = mod.createInvitationSessionCookie({
      invitationId: "invite-expired-payload",
      sessionToken: "session-token-expired-payload",
      expiresAtEpochMs: Date.now() - 10_000,
    });

    cookiesMock.mockResolvedValue({ get: () => ({ value: cookieValue }) });
    queryMock.mockResolvedValueOnce({ rows: [{ exists: false }] });

    const resolved = await mod.resolveInvitationFromCookie();
    expect(resolved).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("stores expected token claims when creating invitation session", async () => {
    const mod = await import("@/lib/invitation-security");
    queryMock.mockResolvedValueOnce({ rows: [] });

    await mod.createInvitationSession({
      invitationId: "invite-session-claims",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0]?.[0])).toContain("token_iss");
    expect(queryMock.mock.calls[0]?.[1]?.slice(5)).toEqual([
      "issuer-test",
      "health-assist-app",
      "invitation_session",
      "invitation_verified_session",
    ]);
  });

  it("accepts invitation session cookie with expected token claims", async () => {
    const mod = await import("@/lib/invitation-security");
    const sessionToken = "session-token-claims";
    const cookieValue = mod.createInvitationSessionCookie({
      invitationId: "invite-claims-ok",
      sessionToken,
      expiresAtEpochMs: Date.now() + 60_000,
    });

    cookiesMock.mockResolvedValue({ get: () => ({ value: cookieValue }) });
    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "invite-claims-ok",
            physician_id: "phys-1",
            patient_email: "patient@example.com",
            patient_name: "Pat Ient",
            patient_dob: null,
            oscar_demographic_no: null,
            token_expires_at: null,
            used_at: null,
            revoked_at: null,
            expires_at: new Date(Date.now() + 60_000),
            lab_report_summary: null,
            previous_lab_report_summary: null,
            form_summary: null,
            summary_expires_at: null,
            summary_deleted_at: null,
            patient_background: null,
            interview_guidance: null,
            organization_website_url: null,
            first_name: "A",
            last_name: "Doctor",
            clinic_name: "Clinic",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const resolved = await mod.resolveInvitationFromCookie();
    expect(resolved?.invitationId).toBe("invite-claims-ok");
    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(queryMock.mock.calls[1]?.[1]).toEqual([
      "invite-claims-ok",
      mod.hashValue(sessionToken),
      "issuer-test",
      "health-assist-app",
      "invitation_session",
      "invitation_verified_session",
    ]);
  });

  it.each([
    { key: "TOKEN_ISSUER", issuedAs: "issuer-a", expectedAtVerify: "issuer-b" },
    { key: "TOKEN_AUDIENCE", issuedAs: "audience-a", expectedAtVerify: "audience-b" },
  ])("rejects invitation session cookie when $key claim mismatches", async ({ key, issuedAs, expectedAtVerify }) => {
    const mod = await import("@/lib/invitation-security");
    process.env[key] = issuedAs;
    const cookieValue = mod.createInvitationSessionCookie({
      invitationId: "invite-claims-bad",
      sessionToken: "session-token-bad",
      expiresAtEpochMs: Date.now() + 60_000,
    });
    process.env[key] = expectedAtVerify;

    cookiesMock.mockResolvedValue({ get: () => ({ value: cookieValue }) });
    queryMock.mockResolvedValueOnce({ rows: [{ exists: false }] });

    const resolved = await mod.resolveInvitationFromCookie();
    expect(resolved).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { claim: "type", issuedAs: "wrong_type", expectedAtVerify: "invitation_session" },
    { claim: "context", issuedAs: "wrong_context", expectedAtVerify: "invitation_verified_session" },
  ])("rejects invitation session cookie when $claim claim mismatches", async ({ claim, issuedAs, expectedAtVerify }) => {
    const mod = await import("@/lib/invitation-security");
    const original = mod.createInvitationSessionCookie({
      invitationId: "invite-claims-type-context-bad",
      sessionToken: "session-token-type-context-bad",
      expiresAtEpochMs: Date.now() + 60_000,
    });
    const [payloadB64] = original.split(".");
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<string, unknown>;
    parsed[claim] = issuedAs;
    const mutatedPayloadB64 = Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
    const signature = createHmac("sha256", process.env.SESSION_SECRET || "dev-only-invitation-secret-change-me")
      .update(mutatedPayloadB64)
      .digest("base64url");
    const mutatedCookie = `${mutatedPayloadB64}.${signature}`;

    cookiesMock.mockResolvedValue({ get: () => ({ value: mutatedCookie }) });
    queryMock.mockResolvedValueOnce({ rows: [{ exists: false }] });

    const resolved = await mod.resolveInvitationFromCookie();
    expect(resolved).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(parsed[claim]).toBe(issuedAs);
    expect(expectedAtVerify.length).toBeGreaterThan(0);
  });

  it("rejects invitation session when DB claim match fails", async () => {
    const mod = await import("@/lib/invitation-security");
    const sessionToken = "session-token-db-claim-miss";
    const cookieValue = mod.createInvitationSessionCookie({
      invitationId: "invite-db-claim-miss",
      sessionToken,
      expiresAtEpochMs: Date.now() + 60_000,
    });

    cookiesMock.mockResolvedValue({ get: () => ({ value: cookieValue }) });
    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({ rows: [] });

    const resolved = await mod.resolveInvitationFromCookie();
    expect(resolved).toBeNull();
    expect(queryMock.mock.calls[1]?.[1]).toEqual([
      "invite-db-claim-miss",
      mod.hashValue(sessionToken),
      "issuer-test",
      "health-assist-app",
      "invitation_session",
      "invitation_verified_session",
    ]);
  });

  it("hides summaries when summary TTL is expired", async () => {
    const mod = await import("@/lib/invitation-security");
    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({
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
