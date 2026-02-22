import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentSessionMock,
  loadSessionAccessScopeMock,
  canAccessSessionInScopeMock,
  loadSessionPatientIdMock,
  queryMock,
  logPhysicianPhiAuditMock,
} = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  loadSessionAccessScopeMock: vi.fn(),
  canAccessSessionInScopeMock: vi.fn(),
  loadSessionPatientIdMock: vi.fn(),
  queryMock: vi.fn(),
  logPhysicianPhiAuditMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentSession: getCurrentSessionMock,
}));

vi.mock("@/lib/session-access", () => ({
  loadSessionAccessScope: loadSessionAccessScopeMock,
  canAccessSessionInScope: canAccessSessionInScopeMock,
  loadSessionPatientId: loadSessionPatientIdMock,
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

import { GET, POST } from "./route";

const endpoint = "http://localhost/api/prescriptions";
const baseSession = {
  userId: "11111111-1111-4111-8111-111111111111",
  userType: "provider",
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

describe("POST /api/prescriptions", () => {
  beforeEach(() => {
    getCurrentSessionMock.mockResolvedValue(baseSession);
    loadSessionAccessScopeMock.mockResolvedValue({
      physicianId: "22222222-2222-4222-8222-222222222222",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    canAccessSessionInScopeMock.mockReturnValue(true);
    loadSessionPatientIdMock.mockResolvedValue("33333333-3333-4333-8333-333333333333");
    logPhysicianPhiAuditMock.mockResolvedValue(undefined);
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // columns lookup
      .mockResolvedValueOnce({ rows: [{ id: "prescription-1" }] }); // insert
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

  it("returns 403 for cross-org access", async () => {
    canAccessSessionInScopeMock.mockReturnValueOnce(false);
    const request = new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionCode: "session-1" }),
    });
    const response = await POST(request as any);
    expect(response.status).toBe(403);
  });

  it("returns 200 and logs audit for same-org", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "user-agent": "vitest" },
      body: JSON.stringify({
        sessionCode: "session-1",
        patientName: "Patient Name",
        patientEmail: "patient@example.com",
        medications: [{ medication: "Drug A", sig: "daily" }],
        pdfBase64: Buffer.from("fake-pdf").toString("base64"),
        attestationAccepted: true,
        safetyChecklist: {
          allergiesReviewed: true,
          interactionsReviewed: true,
          renalRiskReviewed: true,
          giRiskReviewed: true,
          anticoagulantReviewed: true,
          pregnancyReviewed: true,
        },
      }),
    });
    const response = await POST(request as any);
    expect(response.status).toBe(200);
    expect(logPhysicianPhiAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "prescription_saved" }),
    );
  });
});

describe("GET /api/prescriptions", () => {
  beforeEach(() => {
    getCurrentSessionMock.mockResolvedValue(baseSession);
    loadSessionAccessScopeMock.mockResolvedValue({
      physicianId: "22222222-2222-4222-8222-222222222222",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    canAccessSessionInScopeMock.mockReturnValue(true);
    loadSessionPatientIdMock.mockResolvedValue("33333333-3333-4333-8333-333333333333");
    logPhysicianPhiAuditMock.mockResolvedValue(undefined);
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // columns lookup
      .mockResolvedValueOnce({
        rows: [
          {
            id: "prescription-1",
            patient_name: "Patient Name",
            patient_email: "patient@example.com",
            physician_name: "Dr. Who",
            clinic_name: "Clinic",
            clinic_address: null,
            medication: "Drug A",
            strength: null,
            sig: "daily",
            quantity: null,
            refills: null,
            notes: null,
            medications: null,
            fax_status: null,
            fax_error: null,
            fax_sent_at: null,
            prescription_status: null,
            attestation_text: null,
            attested_at: null,
            authorized_by: null,
            authorized_at: null,
            content_hash: null,
            created_at: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    const response = await GET(new Request(`${endpoint}?code=session-1`) as any);
    expect(response.status).toBe(401);
  });

  it("returns 403 for cross-org access", async () => {
    canAccessSessionInScopeMock.mockReturnValueOnce(false);
    const response = await GET(new Request(`${endpoint}?code=session-1`) as any);
    expect(response.status).toBe(403);
  });

  it("returns 200 and logs audit for same-org", async () => {
    const response = await GET(
      new Request(`${endpoint}?code=session-1`, {
        headers: { "user-agent": "vitest" },
      }) as any,
    );
    expect(response.status).toBe(200);
    expect(logPhysicianPhiAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "prescription_viewed" }),
    );
  });
});

