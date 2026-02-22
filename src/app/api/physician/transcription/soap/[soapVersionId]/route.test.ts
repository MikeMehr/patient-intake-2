import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentSessionMock,
  getSoapVersionByIdForScopeMock,
  logPhysicianPhiAuditMock,
} = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  getSoapVersionByIdForScopeMock: vi.fn(),
  logPhysicianPhiAuditMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentSession: getCurrentSessionMock,
}));

vi.mock("@/lib/transcription-store", () => ({
  getSoapVersionByIdForScope: getSoapVersionByIdForScopeMock,
  resolveWorkforceScope: vi.fn(({ userType, userId, organizationId }) => {
    if (userType === "org_admin" && organizationId) return { organizationId };
    if (userType === "provider" && organizationId) return { organizationId };
    if (userType === "provider") return { physicianId: userId };
    return null;
  }),
}));

vi.mock("@/lib/phi-audit", () => ({
  logPhysicianPhiAudit: logPhysicianPhiAuditMock,
}));

vi.mock("@/lib/invitation-security", () => ({
  getRequestIp: vi.fn(() => "127.0.0.1"),
}));

import { GET } from "./route";

const endpoint = "http://localhost/api/physician/transcription/soap/33333333-3333-4333-8333-333333333333";

describe("GET /api/physician/transcription/soap/[soapVersionId]", () => {
  beforeEach(() => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      userType: "provider",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    getSoapVersionByIdForScopeMock.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      encounter_id: "44444444-4444-4444-8444-444444444444",
      patient_id: "55555555-5555-4555-8555-555555555555",
      version: 1,
      lifecycle_state: "DRAFT",
      subjective: "Subjective",
      objective: "Objective",
      assessment: "Assessment",
      plan: "Plan",
      draft_transcript: "Transcript",
      finalized_for_export_at: null,
    });
    logPhysicianPhiAuditMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    const response = await GET(
      new Request(endpoint) as any,
      { params: Promise.resolve({ soapVersionId: "33333333-3333-4333-8333-333333333333" }) } as any,
    );
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-workforce user", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "11111111-1111-4111-8111-111111111111",
      userType: "super_admin",
      organizationId: null,
    });
    const response = await GET(
      new Request(endpoint) as any,
      { params: Promise.resolve({ soapVersionId: "33333333-3333-4333-8333-333333333333" }) } as any,
    );
    expect(response.status).toBe(403);
  });

  it("returns 200 for same-org workforce and logs audit", async () => {
    const response = await GET(
      new Request(endpoint, { headers: { "user-agent": "vitest" } }) as any,
      { params: Promise.resolve({ soapVersionId: "33333333-3333-4333-8333-333333333333" }) } as any,
    );
    expect(response.status).toBe(200);
    expect(logPhysicianPhiAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "transcription_soap_viewed",
      }),
    );
  });
});

