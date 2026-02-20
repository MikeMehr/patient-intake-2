import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentSessionMock,
  getSoapVersionByIdMock,
  recordEmrExportAttemptMock,
  logPhysicianPhiAuditMock,
} = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  getSoapVersionByIdMock: vi.fn(),
  recordEmrExportAttemptMock: vi.fn(),
  logPhysicianPhiAuditMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentSession: getCurrentSessionMock,
}));

vi.mock("@/lib/transcription-store", () => ({
  getSoapVersionById: getSoapVersionByIdMock,
  recordEmrExportAttempt: recordEmrExportAttemptMock,
}));

vi.mock("@/lib/phi-audit", () => ({
  logPhysicianPhiAudit: logPhysicianPhiAuditMock,
}));

import { POST } from "./route";

const endpoint = "http://localhost/api/physician/transcription/mark-exported";

describe("POST /api/physician/transcription/mark-exported", () => {
  beforeEach(() => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "22222222-2222-4222-8222-222222222222",
      userType: "provider",
    });
    getSoapVersionByIdMock.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      lifecycle_state: "FINALIZED_FOR_EXPORT",
    });
    recordEmrExportAttemptMock.mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      encounterId: "55555555-5555-4555-8555-555555555555",
      patientId: "66666666-6666-4666-8666-666666666666",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records v1 manual export as sent without external reference id", async () => {
    const request = new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        soapVersionId: "33333333-3333-4333-8333-333333333333",
        idempotencyKey: "idempotency-key-12345",
        destinationSystem: "manual_copy_paste",
      }),
    });

    const response = await POST(request as any);
    const body = (await response.json()) as { success?: boolean; exportAttemptId?: string };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.exportAttemptId).toBe("44444444-4444-4444-8444-444444444444");
    expect(recordEmrExportAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        soapVersionId: "33333333-3333-4333-8333-333333333333",
        status: "sent",
        externalReferenceId: undefined,
      }),
    );
  });
});
