import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const decryptStringMock = vi.hoisted(() => vi.fn());
const encryptStringMock = vi.hoisted(() => vi.fn());
const oscarExchangeAccessTokenMock = vi.hoisted(() => vi.fn());
const getRequestIdMock = vi.hoisted(() => vi.fn());
const logRequestMetaMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/encrypted-field", () => ({
  decryptString: (...args: unknown[]) => decryptStringMock(...args),
  encryptString: (...args: unknown[]) => encryptStringMock(...args),
}));

vi.mock("@/lib/oscar/client", () => ({
  oscarExchangeAccessToken: (...args: unknown[]) => oscarExchangeAccessTokenMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: (...args: unknown[]) => getRequestIdMock(...args),
  logRequestMeta: (...args: unknown[]) => logRequestMetaMock(...args),
}));

describe("GET /api/admin/emr/oscar/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TOKEN_ISSUER = "issuer-test";
    process.env.TOKEN_AUDIENCE = "audience-test";
    getRequestIdMock.mockReturnValue("req-1");
    decryptStringMock.mockImplementation((value: string) => `dec:${value}`);
    encryptStringMock.mockImplementation((value: string) => `enc:${value}`);
    oscarExchangeAccessTokenMock.mockResolvedValue({
      accessToken: "at-1",
      tokenSecret: "ats-1",
    });
  });

  it("rejects callback when OAuth request token lookup fails claim checks", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/emr/oscar/callback?oauth_token=rt-1&oauth_verifier=v-1") as any,
    );

    expect(response.status).toBe(400);
    expect(String(queryMock.mock.calls[0]?.[0] || "")).toContain("token_iss = $2");
    expect(queryMock.mock.calls[0]?.[1]).toEqual([
      "rt-1",
      "issuer-test",
      "audience-test",
      "oauth_request",
      "emr_oscar_oauth_request",
    ]);
    expect(oscarExchangeAccessTokenMock).not.toHaveBeenCalled();
  });

  it("completes callback on valid token + claim match", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            organization_id: "org-1",
            request_token: "rt-1",
            request_token_secret_enc: "secret-enc",
            expires_at: new Date(Date.now() + 60_000),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { base_url: "https://oscar.example", client_key: "client-key", client_secret_enc: "client-secret-enc" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/emr/oscar/callback?oauth_token=rt-1&oauth_verifier=v-1") as any,
    );

    expect(response.status).toBe(302);
    expect(oscarExchangeAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(String(queryMock.mock.calls[3]?.[0] || "")).toContain("DELETE FROM emr_oauth_requests");
  });
});
