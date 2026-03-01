import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
const createLabEditorSessionMock = vi.hoisted(() => vi.fn());
const getLabEditorSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/session-store", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/lab-requisition-editor-session", () => ({
  createLabEditorSession: (...args: unknown[]) => createLabEditorSessionMock(...args),
  getLabEditorSession: (...args: unknown[]) => getLabEditorSessionMock(...args),
}));

vi.mock("@/lib/lab-requisition-mapping", () => ({
  mapLabTestsToEformFields: vi.fn(() => ({ mappedFieldIds: [], unmappedTests: [] })),
}));

vi.mock("@/lib/lab-requisition-payload", () => ({
  buildLabRequisitionPrefillPayload: vi.fn(() => ({ requestId: "req-test" })),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("/api/lab-requisitions/editor-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns 403 for non-provider users (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/lab-requisitions/editor-session?token=token-1") as any,
    );

    expect(response.status).toBe(403);
    expect(getLabEditorSessionMock).not.toHaveBeenCalled();
  });

  it("POST returns 403 for non-provider users (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/lab-requisitions/editor-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionCode: "session-1", requisitionId: "req-1" }),
      }) as any,
    );

    expect(response.status).toBe(403);
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("POST returns 403 when provider accesses another provider session (object boundary)", async () => {
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
      new Request("http://localhost/api/lab-requisitions/editor-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionCode: "session-1", requisitionId: "req-1" }),
      }) as any,
    );

    expect(response.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
    expect(createLabEditorSessionMock).not.toHaveBeenCalled();
  });
});
