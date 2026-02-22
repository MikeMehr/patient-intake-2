import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  getCurrentSessionMock,
  queryMock,
  logPhysicianPhiAuditMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  queryMock: vi.fn(),
  logPhysicianPhiAuditMock: vi.fn(),
}));

vi.mock("@/lib/session-store", () => ({
  generateSessionCode: vi.fn(),
  getSession: getSessionMock,
  storeSession: vi.fn(),
  sessionExists: vi.fn(),
  cleanupExpiredSessions: vi.fn().mockResolvedValue(0),
  deleteSession: vi.fn(),
  updateSessionHistoryFields: vi.fn(),
  updateSessionPatientProfilePharmacyFields: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentSession: getCurrentSessionMock,
}));

vi.mock("@/lib/db", () => ({
  query: queryMock,
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

import { GET } from "./route";

const endpoint = "http://localhost/api/sessions";

describe("GET /api/sessions", () => {
  beforeEach(() => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      userType: "provider",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    logPhysicianPhiAuditMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when session code is missing", async () => {
    const request = new Request(endpoint);
    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    const request = new Request(`${endpoint}?code=session-123`);
    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("returns 403 for cross-organization access", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          physician_id: "22222222-2222-4222-8222-222222222222",
          organization_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      ],
    });

    const request = new Request(`${endpoint}?code=session-123`);
    const response = await GET(request);
    expect(response.status).toBe(403);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("returns 403 for legacy org-null non-owner provider", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          physician_id: "33333333-3333-4333-8333-333333333333",
          organization_id: null,
        },
      ],
    });

    const request = new Request(`${endpoint}?code=session-legacy`);
    const response = await GET(request);
    expect(response.status).toBe(403);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when scoped session record cannot be loaded", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          physician_id: "22222222-2222-4222-8222-222222222222",
          organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      ],
    });
    getSessionMock.mockResolvedValueOnce(null);

    const request = new Request(`${endpoint}?code=missing-session`);
    const response = await GET(request);
    expect(response.status).toBe(404);
  });

  it("returns 200 for same-organization access and writes audit event", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            physician_id: "22222222-2222-4222-8222-222222222222",
            organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ patient_id: "44444444-4444-4444-8444-444444444444" }],
      });

    getSessionMock.mockResolvedValueOnce({
      sessionCode: "session-123",
      patientEmail: "patient@example.com",
      patientName: "Pat Ient",
      chiefComplaint: "Headache",
      patientProfile: {},
      history: {},
      completedAt: new Date("2026-01-01T00:00:00.000Z"),
      physicianId: "22222222-2222-4222-8222-222222222222",
      viewedByPhysician: true,
      viewedAt: new Date("2026-01-01T01:00:00.000Z"),
      transcript: [{ role: "patient", content: "Test" }],
    });

    const request = new Request(`${endpoint}?code=session-123`, {
      headers: { "user-agent": "vitest" },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessionCode).toBe("session-123");
    expect(logPhysicianPhiAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        physicianId: "11111111-1111-4111-8111-111111111111",
        patientId: "44444444-4444-4444-8444-444444444444",
        eventType: "session_viewed",
      }),
    );
  });
});

