import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const updateSessionFinalCommentsEnglishMock = vi.hoisted(() => vi.fn());
const getAzureOpenAIClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/session-store", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  updateSessionFinalCommentsEnglish: (...args: unknown[]) => updateSessionFinalCommentsEnglishMock(...args),
}));

vi.mock("@/lib/azure-openai", () => ({
  getAzureOpenAIClient: (...args: unknown[]) => getAzureOpenAIClientMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

vi.mock("@/lib/secure-logger", () => ({
  logDebug: vi.fn(),
}));

describe("POST /api/physician/translate-final-comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HIPAA_MODE = "false";
  });

  it("returns 403 for non-provider users (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/physician/translate-final-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionCode: "session-1" }),
      }) as any,
    );

    expect(response.status).toBe(403);
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(getAzureOpenAIClientMock).not.toHaveBeenCalled();
  });

  it("returns 403 when provider accesses another provider session (object boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "provider-1",
      userType: "provider",
      organizationId: "org-1",
    });
    getSessionMock.mockResolvedValueOnce({
      physicianId: "provider-2",
      history: { patientFinalQuestionsComments: "hola" },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/physician/translate-final-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionCode: "session-1" }),
      }) as any,
    );

    expect(response.status).toBe(403);
    expect(getAzureOpenAIClientMock).not.toHaveBeenCalled();
    expect(updateSessionFinalCommentsEnglishMock).not.toHaveBeenCalled();
  });
});
