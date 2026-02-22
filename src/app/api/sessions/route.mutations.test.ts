import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentSessionMock,
  updateSessionHistoryFieldsMock,
  updateSessionPatientProfilePharmacyFieldsMock,
  deleteSessionMock,
  loadSessionAccessScopeMock,
  canAccessSessionInScopeMock,
  loadSessionPatientIdMock,
  logPhysicianPhiAuditMock,
} = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  updateSessionHistoryFieldsMock: vi.fn(),
  updateSessionPatientProfilePharmacyFieldsMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  loadSessionAccessScopeMock: vi.fn(),
  canAccessSessionInScopeMock: vi.fn(),
  loadSessionPatientIdMock: vi.fn(),
  logPhysicianPhiAuditMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentSession: getCurrentSessionMock,
}));

vi.mock("@/lib/session-store", () => ({
  generateSessionCode: vi.fn(),
  getSession: vi.fn(),
  storeSession: vi.fn(),
  sessionExists: vi.fn(),
  cleanupExpiredSessions: vi.fn().mockResolvedValue(0),
  deleteSession: deleteSessionMock,
  updateSessionHistoryFields: updateSessionHistoryFieldsMock,
  updateSessionPatientProfilePharmacyFields: updateSessionPatientProfilePharmacyFieldsMock,
}));

vi.mock("@/lib/session-access", () => ({
  loadSessionAccessScope: loadSessionAccessScopeMock,
  canAccessSessionInScope: canAccessSessionInScopeMock,
  loadSessionPatientId: loadSessionPatientIdMock,
}));

vi.mock("@/lib/phi-audit", () => ({
  logPhysicianPhiAudit: logPhysicianPhiAuditMock,
}));

vi.mock("@/lib/azure-openai", () => ({
  getAzureOpenAIClient: vi.fn(),
}));

vi.mock("@/lib/invitation-security", () => ({
  consumeRateLimit: vi.fn(),
  getRequestIp: vi.fn(() => "127.0.0.1"),
  logInvitationAudit: vi.fn(),
  markInvitationUsed: vi.fn(),
  resolveInvitationFromCookie: vi.fn(),
}));

vi.mock("@/lib/patient-store", () => ({
  createEncounterFromSession: vi.fn(),
  upsertPatientFromSession: vi.fn(),
}));

import { DELETE, PUT } from "./route";

const endpoint = "http://localhost/api/sessions";
const userSession = {
  userId: "11111111-1111-4111-8111-111111111111",
  userType: "provider",
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

describe("PUT /api/sessions", () => {
  beforeEach(() => {
    getCurrentSessionMock.mockResolvedValue(userSession);
    loadSessionAccessScopeMock.mockResolvedValue({
      physicianId: "22222222-2222-4222-8222-222222222222",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    canAccessSessionInScopeMock.mockReturnValue(true);
    updateSessionHistoryFieldsMock.mockResolvedValue(true);
    logPhysicianPhiAuditMock.mockResolvedValue(undefined);
    loadSessionPatientIdMock.mockResolvedValue("33333333-3333-4333-8333-333333333333");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    const request = new Request(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionCode: "session-123",
        historySummary: "This is a valid summary text.",
        historyAssessment: "This is a valid assessment text.",
        historyPlan: ["Plan item"],
      }),
    });
    const response = await PUT(request);
    expect(response.status).toBe(401);
  });

  it("returns 403 when cross-org access denied", async () => {
    canAccessSessionInScopeMock.mockReturnValueOnce(false);
    const request = new Request(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionCode: "session-123",
        historySummary: "This is a valid summary text.",
        historyAssessment: "This is a valid assessment text.",
        historyPlan: ["Plan item"],
      }),
    });
    const response = await PUT(request);
    expect(response.status).toBe(403);
  });

  it("returns 200 and logs audit for same-org update", async () => {
    const request = new Request(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "user-agent": "vitest" },
      body: JSON.stringify({
        sessionCode: "session-123",
        historySummary: "This is a valid summary text.",
        historyAssessment: "This is a valid assessment text.",
        historyPlan: ["Plan item"],
      }),
    });
    const response = await PUT(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(logPhysicianPhiAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "session_updated",
        physicianId: userSession.userId,
      }),
    );
  });
});

describe("DELETE /api/sessions", () => {
  beforeEach(() => {
    getCurrentSessionMock.mockResolvedValue(userSession);
    loadSessionAccessScopeMock.mockResolvedValue({
      physicianId: "22222222-2222-4222-8222-222222222222",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    canAccessSessionInScopeMock.mockReturnValue(true);
    logPhysicianPhiAuditMock.mockResolvedValue(undefined);
    loadSessionPatientIdMock.mockResolvedValue("33333333-3333-4333-8333-333333333333");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    const request = new Request(`${endpoint}?code=session-123`, { method: "DELETE" });
    const response = await DELETE(request);
    expect(response.status).toBe(401);
  });

  it("returns 403 when cross-org access denied", async () => {
    canAccessSessionInScopeMock.mockReturnValueOnce(false);
    const request = new Request(`${endpoint}?code=session-123`, { method: "DELETE" });
    const response = await DELETE(request);
    expect(response.status).toBe(403);
  });

  it("returns 200 and logs audit for same-org delete", async () => {
    const request = new Request(`${endpoint}?code=session-123`, {
      method: "DELETE",
      headers: { "user-agent": "vitest" },
    });
    const response = await DELETE(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deleteSessionMock).toHaveBeenCalledWith("session-123");
    expect(logPhysicianPhiAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "session_deleted",
        physicianId: userSession.userId,
      }),
    );
  });
});

