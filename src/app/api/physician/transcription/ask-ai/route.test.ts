import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.hoisted(() => vi.fn());
const getAzureOpenAIClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentSession: (...args: unknown[]) => getCurrentSessionMock(...args),
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

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/physician/transcription/ask-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const providerSession = {
  userId: "provider-1",
  userType: "provider",
  organizationId: "org-1",
};

describe("POST /api/physician/transcription/ask-ai", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.HIPAA_MODE = "false";
  });

  it("returns 503 when HIPAA_MODE is enabled", async () => {
    process.env.HIPAA_MODE = "true";
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ soapText: "test", prompt: "test" }));
    expect(response.status).toBe(503);
  });

  it("returns 400 when soapText is missing", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ prompt: "test" }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("soapText");
  });

  it("returns 400 when prompt is missing", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ soapText: "Subjective: headache" }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("prompt");
  });

  it("returns 401 when not authenticated", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ soapText: "test", prompt: "test" }));
    expect(response.status).toBe(401);
    expect(getAzureOpenAIClientMock).not.toHaveBeenCalled();
  });

  it("returns 403 for non-provider users (role boundary)", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({
      userId: "org-admin-1",
      userType: "org_admin",
      organizationId: "org-1",
    });
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ soapText: "test", prompt: "test" }));
    expect(response.status).toBe(403);
    expect(getAzureOpenAIClientMock).not.toHaveBeenCalled();
  });

  it("returns 200 with result on success", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(providerSession);
    getAzureOpenAIClientMock.mockReturnValueOnce({
      client: {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValueOnce({
              choices: [{ message: { content: "Dear colleague, I am referring..." } }],
            }),
          },
        },
      },
      deployment: "test-deployment",
    });
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ soapText: "Subjective: headache\nObjective: none", prompt: "generate referral letter" }),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result).toBe("Dear colleague, I am referring...");
  });

  it("returns 502 when Azure OpenAI fails", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(providerSession);
    getAzureOpenAIClientMock.mockReturnValueOnce({
      client: {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValueOnce(new Error("Azure timeout")),
          },
        },
      },
      deployment: "test-deployment",
    });
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ soapText: "Subjective: headache", prompt: "generate referral" }),
    );
    expect(response.status).toBe(502);
  });
});
