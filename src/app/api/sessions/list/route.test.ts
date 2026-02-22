import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentSessionMock,
  getSessionsByScopeMock,
  queryMock,
  logPhysicianPhiAuditMock,
} = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  getSessionsByScopeMock: vi.fn(),
  queryMock: vi.fn(),
  logPhysicianPhiAuditMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentSession: getCurrentSessionMock,
}));

vi.mock("@/lib/session-store", () => ({
  getSessionsByScope: getSessionsByScopeMock,
  cleanupExpiredSessions: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/db", () => ({
  query: queryMock,
}));

vi.mock("@/lib/phi-audit", () => ({
  logPhysicianPhiAudit: logPhysicianPhiAuditMock,
}));

vi.mock("@/lib/invitation-security", () => ({
  getRequestIp: vi.fn(() => "127.0.0.1"),
}));

import { GET } from "./route";

const endpoint = "http://localhost/api/sessions/list";

describe("GET /api/sessions/list", () => {
  beforeEach(() => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      userType: "provider",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    getSessionsByScopeMock.mockResolvedValue([
      {
        sessionCode: "session-1",
        patientEmail: "patient@example.com",
        patientName: "Pat Ient",
        chiefComplaint: "Headache",
        patientProfile: {},
        history: {},
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
        physicianId: "22222222-2222-4222-8222-222222222222",
        viewedByPhysician: true,
        viewedAt: new Date("2026-01-01T01:00:00.000Z"),
      },
    ]);
    queryMock.mockResolvedValue({
      rows: [{ source_session_code: "session-1", patient_id: "33333333-3333-4333-8333-333333333333" }],
    });
    logPhysicianPhiAuditMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    const response = await GET(new Request(endpoint) as any);
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-workforce user", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "11111111-1111-4111-8111-111111111111",
      userType: "super_admin",
      organizationId: null,
    });
    const response = await GET(new Request(endpoint) as any);
    expect(response.status).toBe(403);
  });

  it("returns 200 for same-org viewer and logs audit", async () => {
    const response = await GET(
      new Request(endpoint, {
        headers: { "user-agent": "vitest" },
      }) as any,
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(logPhysicianPhiAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "session_list_viewed",
      }),
    );
  });
});

