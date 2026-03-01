import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const sendFaxViaSrfaxMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/session-store", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/srfax", () => ({
  sendFaxViaSrfax: (...args: unknown[]) => sendFaxViaSrfaxMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

const validSafetyChecklist = {
  allergiesReviewed: true,
  interactionsReviewed: true,
  renalRiskReviewed: true,
  giRiskReviewed: true,
  anticoagulantReviewed: true,
  pregnancyReviewed: true,
};

describe("POST /api/prescriptions/fax", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-provider users (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/prescriptions/fax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionCode: "session-1",
          faxNumber: "1234567890",
          pdfBase64: Buffer.from("pdf").toString("base64"),
          attestationAccepted: true,
          safetyChecklist: validSafetyChecklist,
        }),
      }) as any,
    );

    expect(response.status).toBe(403);
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(sendFaxViaSrfaxMock).not.toHaveBeenCalled();
  });

  it("returns 403 when provider accesses another provider session (object boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
      organizationId: "org-1",
    });
    getSessionMock.mockResolvedValueOnce({
      physicianId: "provider-2",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/prescriptions/fax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionCode: "session-1",
          faxNumber: "1234567890",
          pdfBase64: Buffer.from("pdf").toString("base64"),
          attestationAccepted: true,
          safetyChecklist: validSafetyChecklist,
        }),
      }) as any,
    );

    expect(response.status).toBe(403);
    expect(sendFaxViaSrfaxMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });
});
