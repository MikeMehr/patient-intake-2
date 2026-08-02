import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
const getOscarCredsForOrgMock = vi.hoisted(() => vi.fn());
const fetchOscarDemographicMock = vi.hoisted(() => vi.fn());
const upsertPatientFromOscarDemographicMock = vi.hoisted(() => vi.fn());
const logPhysicianPhiAuditMock = vi.hoisted(() => vi.fn());
const resolveAllowedOpenerOriginMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getEffectivePhysicianId: (session: { userId: string; linkedPhysicianId?: string }) =>
    session.linkedPhysicianId ?? session.userId,
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/oscar/self-serve", () => ({
  getOscarCredsForOrg: (...args: unknown[]) => getOscarCredsForOrgMock(...args),
}));

vi.mock("@/lib/oscar/demographics", () => ({
  fetchOscarDemographic: (...args: unknown[]) => fetchOscarDemographicMock(...args),
}));

vi.mock("@/lib/transcription-store", () => ({
  resolveWorkforceScope: (params: { organizationId?: string | null; userId: string }) =>
    params.organizationId ? { organizationId: params.organizationId } : { physicianId: params.userId },
  upsertPatientFromOscarDemographic: (...args: unknown[]) =>
    upsertPatientFromOscarDemographicMock(...args),
}));

vi.mock("@/lib/oscar/launch-origins", () => ({
  resolveAllowedOpenerOrigin: (...args: unknown[]) => resolveAllowedOpenerOriginMock(...args),
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

const URL_ = "http://localhost/api/physician/oscar-launch/resolve";

function post(body: unknown) {
  return new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PROVIDER = { userId: "phys-1", userType: "provider", organizationId: "org-1" };

describe("POST /api/physician/oscar-launch/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllowedOpenerOriginMock.mockReturnValue("https://oscar.mymdonline.ca");
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("returns 401 without a session", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    const res = await POST(post({ demographicNo: "46" }) as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-provider users", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });
    const { POST } = await import("./route");
    const res = await POST(post({ demographicNo: "46" }) as never);
    expect(res.status).toBe(403);
  });

  it("returns 400 for a malformed demographicNo", async () => {
    getCurrentSessionMock.mockResolvedValue(PROVIDER);
    const { POST } = await import("./route");
    for (const bad of ["", "abc", "-1", "1.5", "46; DROP TABLE patients", "1234567890123"]) {
      const res = await POST(post({ demographicNo: bad }) as never);
      expect(res.status, `expected 400 for ${JSON.stringify(bad)}`).toBe(400);
    }
    expect(getOscarCredsForOrgMock).not.toHaveBeenCalled();
  });

  it("resolves locally without touching OSCAR", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(PROVIDER);
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "pat-1",
          full_name: "Ali Test",
          date_of_birth: "1981-09-16",
          email: "ali@example.com",
          primary_phone: "604-555-0101",
        },
      ],
      rowCount: 1,
    });

    const { POST } = await import("./route");
    const res = await POST(post({ demographicNo: "46" }) as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      status: "resolved",
      matchedBy: "oscar_demographic_no",
      patient: { id: "pat-1", fullName: "Ali Test", dateOfBirth: "1981-09-16" },
      allowedOpenerOrigin: "https://oscar.mymdonline.ca",
    });
    // The whole point of local-first: works with the clinic LAN down.
    expect(getOscarCredsForOrgMock).not.toHaveBeenCalled();
    expect(fetchOscarDemographicMock).not.toHaveBeenCalled();
    expect(logPhysicianPhiAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "oscar_launch_patient_resolved",
        patientId: "pat-1",
        metadata: expect.objectContaining({ oscarDemographicNo: "46", oscarFetched: false }),
      }),
    );
  });

  it("never puts patient name or DOB in the audit metadata", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(PROVIDER);
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: "pat-1", full_name: "Ali Test", date_of_birth: "1981-09-16", email: null, primary_phone: null },
      ],
      rowCount: 1,
    });
    const { POST } = await import("./route");
    await POST(post({ demographicNo: "46" }) as never);
    const metadata = JSON.stringify(logPhysicianPhiAuditMock.mock.calls[0][0].metadata);
    expect(metadata).not.toContain("Ali Test");
    expect(metadata).not.toContain("1981-09-16");
  });

  it("degrades to oscar_not_connected with a 200, not an error", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(PROVIDER);
    getOscarCredsForOrgMock.mockResolvedValueOnce(null);

    const { POST } = await import("./route");
    const res = await POST(post({ demographicNo: "46" }) as never);
    const json = await res.json();

    // 200 on purpose — the doctor can still dictate with manual patient entry.
    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      status: "oscar_not_connected",
      allowedOpenerOrigin: "https://oscar.mymdonline.ca",
    });
  });

  it("degrades to not_found_in_oscar when the fetch fails", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(PROVIDER);
    getOscarCredsForOrgMock.mockResolvedValueOnce({ restBase: "https://oscar/ws/services" });
    fetchOscarDemographicMock.mockResolvedValueOnce({
      ok: false,
      reason: "not_found",
      status: 404,
      detail: "",
    });

    const { POST } = await import("./route");
    const res = await POST(post({ demographicNo: "999" }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "not_found_in_oscar" });
    expect(upsertPatientFromOscarDemographicMock).not.toHaveBeenCalled();
  });

  it("fetches from OSCAR and upserts the local chart on a local miss", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(PROVIDER);
    getOscarCredsForOrgMock.mockResolvedValueOnce({ restBase: "https://oscar/ws/services" });
    fetchOscarDemographicMock.mockResolvedValueOnce({
      ok: true,
      demographic: {
        demographicNo: "46",
        firstName: "Ali",
        lastName: "Test",
        dateOfBirth: "1981-09-16",
        patientEmail: "ali@example.com",
        primaryPhone: "604-555-0101",
        secondaryPhone: null,
        insuranceNumber: null,
        patientAddress: null,
      },
    });
    upsertPatientFromOscarDemographicMock.mockResolvedValueOnce({
      patientId: "pat-2",
      patientName: "Ali Test",
      matchedBy: "created",
    });

    const { POST } = await import("./route");
    const res = await POST(post({ demographicNo: "46" }) as never);
    const json = await res.json();

    expect(json).toMatchObject({
      status: "resolved",
      matchedBy: "created",
      patient: { id: "pat-2", fullName: "Ali Test" },
    });
    expect(upsertPatientFromOscarDemographicMock).toHaveBeenCalledWith(
      expect.objectContaining({ oscarDemographicNo: "46", fullName: "Ali Test" }),
    );
    expect(logPhysicianPhiAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ matchedBy: "created", oscarFetched: true }),
      }),
    );
  });

  it("passes the requested opener origin through the allow-list and echoes the verdict", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(PROVIDER);
    resolveAllowedOpenerOriginMock.mockReturnValueOnce(null);
    getOscarCredsForOrgMock.mockResolvedValueOnce(null);

    const { POST } = await import("./route");
    const res = await POST(
      post({ demographicNo: "46", openerOrigin: "https://oscar.mymdonline.ca.evil.com" }) as never,
    );

    expect(resolveAllowedOpenerOriginMock).toHaveBeenCalledWith("https://oscar.mymdonline.ca.evil.com");
    // null means the popup must refuse to post the note anywhere.
    expect(await res.json()).toMatchObject({ allowedOpenerOrigin: null });
  });
});
