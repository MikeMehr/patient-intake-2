import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const getBackupCodeStatusMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/auth-mfa", () => ({
  getBackupCodeStatus: (...args: unknown[]) => getBackupCodeStatusMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

const ID = "super-admin-1";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/super-admin-users/super-admin-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const params = { params: Promise.resolve({ id: ID }) };

/** The row-exists SELECT the route runs before any write. */
function accountExists() {
  queryMock.mockResolvedValueOnce({ rows: [{ id: ID }] });
}

function updateSucceeds(mfaEnabled: boolean) {
  queryMock.mockResolvedValueOnce({ rows: [{ id: ID, mfa_enabled: mfaEnabled }] });
}

/** Did the handler reach the UPDATE, or stop before it? */
function ranUpdate() {
  return queryMock.mock.calls.some((c) => String(c[0]).includes("UPDATE super_admin_users"));
}

describe("PUT /api/admin/super-admin-users/[id]", () => {
  beforeEach(() => {
    queryMock.mockReset();
    getCurrentSessionMock.mockReset();
    getBackupCodeStatusMock.mockReset();
  });

  it("rejects a non-super-admin session (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });

    const { PUT } = await import("./route");
    const response = await PUT(makeRequest({ mfaEnabled: true }), params);

    expect(response.status).toBe(401);
    expect(ranUpdate()).toBe(false);
  });

  it("rejects an unauthenticated caller", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);

    const { PUT } = await import("./route");
    const response = await PUT(makeRequest({ mfaEnabled: true }), params);

    expect(response.status).toBe(401);
    expect(ranUpdate()).toBe(false);
  });

  it("400s when no field was supplied", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({ userType: "super_admin" });

    const { PUT } = await import("./route");
    const response = await PUT(makeRequest({}), params);

    expect(response.status).toBe(400);
    expect(ranUpdate()).toBe(false);
  });

  it("404s for an unknown super admin", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({ userType: "super_admin" });
    getBackupCodeStatusMock.mockResolvedValueOnce({ activeCodes: 5 });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { PUT } = await import("./route");
    const response = await PUT(makeRequest({ mfaEnabled: true }), params);

    expect(response.status).toBe(404);
    expect(ranUpdate()).toBe(false);
  });

  it("refuses to enable MFA when the account has no active backup codes", async () => {
    // The lockout guard. No role can recover a super admin, so email-only MFA on an account
    // with no codes is a one-way door.
    getCurrentSessionMock.mockResolvedValueOnce({ userType: "super_admin" });
    accountExists();
    getBackupCodeStatusMock.mockResolvedValueOnce({ activeCodes: 0 });

    const { PUT } = await import("./route");
    const response = await PUT(makeRequest({ mfaEnabled: true }), params);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toMatch(/backup codes/i);
    expect(ranUpdate()).toBe(false);
  });

  it("enables MFA once backup codes exist", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({ userType: "super_admin" });
    accountExists();
    getBackupCodeStatusMock.mockResolvedValueOnce({ activeCodes: 8 });
    updateSucceeds(true);

    const { PUT } = await import("./route");
    const response = await PUT(makeRequest({ mfaEnabled: true }), params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.superAdmin.mfaEnabled).toBe(true);
    expect(ranUpdate()).toBe(true);
  });

  it("allows disabling MFA without requiring backup codes", async () => {
    // Turning the control off must never be blocked by the safety net for turning it on.
    getCurrentSessionMock.mockResolvedValueOnce({ userType: "super_admin" });
    accountExists();
    updateSucceeds(false);

    const { PUT } = await import("./route");
    const response = await PUT(makeRequest({ mfaEnabled: false }), params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.superAdmin.mfaEnabled).toBe(false);
    expect(getBackupCodeStatusMock).not.toHaveBeenCalled();
    expect(ranUpdate()).toBe(true);
  });
});
