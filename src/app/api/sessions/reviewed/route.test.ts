import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentSessionMock,
  queryMock,
  loadSessionAccessScopeMock,
  canAccessSessionInScopeMock,
  loadSessionPatientIdMock,
  logPhysicianPhiAuditMock,
} = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  queryMock: vi.fn(),
  loadSessionAccessScopeMock: vi.fn(),
  canAccessSessionInScopeMock: vi.fn(),
  loadSessionPatientIdMock: vi.fn(),
  logPhysicianPhiAuditMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentSession: getCurrentSessionMock,
}));

vi.mock("@/lib/db", () => ({
  query: queryMock,
}));

vi.mock("@/lib/session-access", () => ({
  loadSessionAccessScope: loadSessionAccessScopeMock,
  canAccessSessionInScope: canAccessSessionInScopeMock,
  loadSessionPatientId: loadSessionPatientIdMock,
}));

vi.mock("@/lib/phi-audit", () => ({
  logPhysicianPhiAudit: logPhysicianPhiAuditMock,
}));

vi.mock("@/lib/invitation-security", () => ({
  getRequestIp: vi.fn(() => "127.0.0.1"),
}));

import { POST } from "./route";

const endpoint = "http://localhost/api/sessions/reviewed";

describe("POST /api/sessions/reviewed", () => {
  beforeEach(() => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      userType: "provider",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    loadSessionAccessScopeMock.mockResolvedValue({
      physicianId: "22222222-2222-4222-8222-222222222222",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    canAccessSessionInScopeMock.mockReturnValue(true);
    queryMock.mockResolvedValue({ rowCount: 1 });
    loadSessionPatientIdMock.mockResolvedValue("33333333-3333-4333-8333-333333333333");
    logPhysicianPhiAuditMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    const request = new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionCode: "session-1" }),
    });
    const response = await POST(request as any);
    expect(response.status).toBe(401);
  });

  it("returns 403 when cross-org access denied", async () => {
    canAccessSessionInScopeMock.mockReturnValueOnce(false);
    const request = new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionCode: "session-1" }),
    });
    const response = await POST(request as any);
    expect(response.status).toBe(403);
  });

  it("returns 200 and logs audit when same-org", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "user-agent": "vitest" },
      body: JSON.stringify({ sessionCode: "session-1" }),
    });
    const response = await POST(request as any);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(logPhysicianPhiAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "session_marked_reviewed",
      }),
    );
  });
});

