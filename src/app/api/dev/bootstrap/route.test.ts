import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const queryMock = vi.fn();
const createInvitationSessionMock = vi.fn();
const hashValueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/invitation-security", () => ({
  createInvitationSession: (...args: unknown[]) => createInvitationSessionMock(...args),
  hashValue: (v: string) => hashValueMock(v),
  INVITATION_SESSION_COOKIE: "invitation_session",
}));

describe("POST /api/dev/bootstrap", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.ENABLE_DEV_INTERVIEW_HARNESS;

  beforeEach(() => {
    queryMock.mockReset();
    createInvitationSessionMock.mockReset();
    hashValueMock.mockImplementation((v: string) =>
      Buffer.from(v, "utf8").toString("hex").slice(0, 64)
    );
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ENABLE_DEV_INTERVIEW_HARNESS = originalFlag;
  });

  it("returns 403 when ENABLE_DEV_INTERVIEW_HARNESS is not set", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.ENABLE_DEV_INTERVIEW_HARNESS;

    const res = await POST(
      new Request("http://localhost/api/dev/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName: "Test",
          patientEmail: "test@localhost",
        }),
      })
    );

    expect(res.status).toBe(403);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toContain("not enabled");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 403 when ENABLE_DEV_INTERVIEW_HARNESS is false", async () => {
    process.env.NODE_ENV = "development";
    process.env.ENABLE_DEV_INTERVIEW_HARNESS = "false";

    const res = await POST(
      new Request("http://localhost/api/dev/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientName: "Test", patientEmail: "test@localhost" }),
      })
    );

    expect(res.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 403 when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    process.env.ENABLE_DEV_INTERVIEW_HARNESS = "true";

    const res = await POST(
      new Request("http://localhost/api/dev/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientName: "Test", patientEmail: "test@localhost" }),
      })
    );

    expect(res.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns expected context and sets invitation cookie when harness is enabled", async () => {
    process.env.NODE_ENV = "development";
    process.env.ENABLE_DEV_INTERVIEW_HARNESS = "true";

    const physicianId = "550e8400-e29b-41d4-a716-446655440000";
    const invitationId = "660e8400-e29b-41d4-a716-446655440001";

    queryMock
      .mockResolvedValueOnce({ rows: [{ id: physicianId }] })
      .mockResolvedValueOnce({
        rows: [{ first_name: "Jane", last_name: "Doe", clinic_name: "Test Clinic" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: invitationId }] });

    createInvitationSessionMock.mockResolvedValue({
      cookieValue: "signed-cookie-value",
      expiresAtMs: Date.now() + 3600000,
    });

    const res = await POST(
      new Request("http://localhost/api/dev/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          physicianSlug: "dr-doe",
          patientName: "Dev Patient",
          patientEmail: "dev@localhost",
          patientDob: "1990-05-15",
        }),
      })
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      invitationId?: string;
      physicianId?: string;
      physicianName?: string;
      clinicName?: string;
      patientName?: string;
      patientEmail?: string;
      patientDob?: string | null;
    };
    expect(data.invitationId).toBe(invitationId);
    expect(data.physicianId).toBe(physicianId);
    expect(data.physicianName).toBe("Dr. Jane Doe");
    expect(data.clinicName).toBe("Test Clinic");
    expect(data.patientName).toBe("Dev Patient");
    expect(data.patientEmail).toBe("dev@localhost");
    expect(data.patientDob).toBe("1990-05-15");

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("invitation_session=");
  });

  it("uses first physician when no physicianId or slug provided", async () => {
    process.env.NODE_ENV = "development";
    process.env.ENABLE_DEV_INTERVIEW_HARNESS = "true";

    const physicianId = "770e8400-e29b-41d4-a716-446655440002";
    const invitationId = "880e8400-e29b-41d4-a716-446655440003";

    queryMock
      .mockResolvedValueOnce({ rows: [{ id: physicianId }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: physicianId,
            first_name: "First",
            last_name: "Provider",
            clinic_name: "First Clinic",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: invitationId }] });

    createInvitationSessionMock.mockResolvedValue({
      cookieValue: "signed-cookie-value",
      expiresAtMs: Date.now() + 3600000,
    });

    const res = await POST(
      new Request("http://localhost/api/dev/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as { physicianId?: string; physicianName?: string };
    expect(data.physicianId).toBe(physicianId);
    expect(data.physicianName).toBe("Dr. First Provider");
  });

  it("returns 400 when no physicians exist in database", async () => {
    process.env.NODE_ENV = "development";
    process.env.ENABLE_DEV_INTERVIEW_HARNESS = "true";

    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await POST(
      new Request("http://localhost/api/dev/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toContain("No physician found");
  });

  it("returns 404 when provided physicianId does not exist", async () => {
    process.env.NODE_ENV = "development";
    process.env.ENABLE_DEV_INTERVIEW_HARNESS = "true";

    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await POST(
      new Request("http://localhost/api/dev/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          physicianId: "00000000-0000-0000-0000-000000000000",
          patientName: "Test",
          patientEmail: "test@localhost",
        }),
      })
    );

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toContain("Physician not found");
  });
});
