import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
const decryptStringMock = vi.hoisted(() => vi.fn());
const encryptStringMock = vi.hoisted(() => vi.fn());
const oscarInitiateMock = vi.hoisted(() => vi.fn());
const oscarAuthorizeUrlMock = vi.hoisted(() => vi.fn());
const getRequestIdMock = vi.hoisted(() => vi.fn());
const logRequestMetaMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/encrypted-field", () => ({
  decryptString: (...args: unknown[]) => decryptStringMock(...args),
  encryptString: (...args: unknown[]) => encryptStringMock(...args),
}));

vi.mock("@/lib/oscar/client", () => ({
  oscarInitiate: (...args: unknown[]) => oscarInitiateMock(...args),
  oscarAuthorizeUrl: (...args: unknown[]) => oscarAuthorizeUrlMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: (...args: unknown[]) => getRequestIdMock(...args),
  logRequestMeta: (...args: unknown[]) => logRequestMetaMock(...args),
}));

describe("POST /api/admin/organizations/[id]/emr/oscar/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TOKEN_ISSUER = "issuer-test";
    process.env.TOKEN_AUDIENCE = "audience-test";
    process.env.NEXT_PUBLIC_APP_URL = "https://mymd.health-assist.org";
    getRequestIdMock.mockReturnValue("req-1");
    getCurrentSessionMock.mockResolvedValue({ userType: "super_admin" });
    queryMock.mockResolvedValueOnce({
      rows: [{ base_url: "https://oscar.example", client_key: "key", client_secret_enc: "secret-enc" }],
    });
    decryptStringMock.mockReturnValue("secret");
    encryptStringMock.mockReturnValue("encrypted-secret");
    oscarInitiateMock.mockResolvedValue({ requestToken: "rt-1", requestTokenSecret: "rts-1" });
    oscarAuthorizeUrlMock.mockReturnValue("https://oscar.example/ws/oauth/authorize?oauth_token=rt-1");
  });

  it("returns 401 for non-super-admin callers", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/organizations/org-1/emr/oscar/connect", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "org-1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("persists expected token claims for OAuth request token", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/organizations/org-1/emr/oscar/connect", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "org-1" }) },
    );

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(String(queryMock.mock.calls[1]?.[0] || "")).toContain("token_iss");
    expect(queryMock.mock.calls[1]?.[1]?.slice(4)).toEqual([
      "issuer-test",
      "audience-test",
      "oauth_request",
      "emr_oscar_oauth_request",
    ]);
  });
});
