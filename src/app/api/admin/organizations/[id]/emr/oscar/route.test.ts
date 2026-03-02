import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
const encryptStringMock = vi.hoisted(() => vi.fn());
const decryptStringMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/encrypted-field", () => ({
  encryptString: (...args: unknown[]) => encryptStringMock(...args),
  decryptString: (...args: unknown[]) => decryptStringMock(...args),
  maskSecret: vi.fn((value: string) => value),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

describe("PUT /api/admin/organizations/[id]/emr/oscar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSessionMock.mockResolvedValue({ userType: "super_admin" });
    encryptStringMock.mockReturnValue("enc-secret");
    queryMock.mockResolvedValue({ rows: [] });
  });

  it("rejects blocked outbound base URLs", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/admin/organizations/org-1/emr/oscar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: "https://localhost:8443",
          clientKey: "client-key",
          clientSecret: "client-secret",
        }),
      }) as any,
      { params: Promise.resolve({ id: "org-1" }) },
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain("blocked host");
    expect(queryMock).not.toHaveBeenCalled();
  });
});
