import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const resolveWorkforceScopeMock = vi.hoisted(() => vi.fn());
const getSoapVersionByIdForScopeMock = vi.hoisted(() => vi.fn());
const updateSoapDraftVersionMock = vi.hoisted(() => vi.fn());
const upsertTranscriptionSessionPointerMock = vi.hoisted(() => vi.fn());
const logPhysicianPhiAuditMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/transcription-store", () => ({
  resolveWorkforceScope: (...args: unknown[]) => resolveWorkforceScopeMock(...args),
  getSoapVersionByIdForScope: (...args: unknown[]) => getSoapVersionByIdForScopeMock(...args),
  updateSoapDraftVersion: (...args: unknown[]) => updateSoapDraftVersionMock(...args),
  upsertTranscriptionSessionPointer: (...args: unknown[]) => upsertTranscriptionSessionPointerMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

vi.mock("@/lib/invitation-security", () => ({
  getRequestIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/phi-audit", () => ({
  logPhysicianPhiAudit: (...args: unknown[]) => logPhysicianPhiAuditMock(...args),
}));

describe("PUT /api/physician/transcription/draft", () => {
  const soapVersionId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-provider users (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });

    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/physician/transcription/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soapVersionId,
          draft: {
            subjective: "Patient reports headache",
            objective: "",
            assessment: "Tension headache",
            plan: "Hydration and rest",
          },
        }),
      }) as any,
    );

    expect(response.status).toBe(403);
    expect(resolveWorkforceScopeMock).not.toHaveBeenCalled();
    expect(getSoapVersionByIdForScopeMock).not.toHaveBeenCalled();
  });

  it("returns 404 when SOAP draft is out of scope (object/tenant boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
      organizationId: "org-1",
    });
    resolveWorkforceScopeMock.mockReturnValueOnce({
      userType: "provider",
      userId: "provider-1",
      organizationId: "org-1",
    });
    getSoapVersionByIdForScopeMock.mockResolvedValueOnce(null);

    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/physician/transcription/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soapVersionId,
          draft: {
            subjective: "Patient reports headache",
            objective: "",
            assessment: "Tension headache",
            plan: "Hydration and rest",
          },
        }),
      }) as any,
    );

    expect(response.status).toBe(404);
    expect(updateSoapDraftVersionMock).not.toHaveBeenCalled();
    expect(upsertTranscriptionSessionPointerMock).not.toHaveBeenCalled();
    expect(logPhysicianPhiAuditMock).not.toHaveBeenCalled();
  });
});
