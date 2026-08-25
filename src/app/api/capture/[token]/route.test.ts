import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPhoneCaptureToken } from "@/lib/phone-capture";

const queryMock = vi.hoisted(() => vi.fn());
const consumeRateLimitMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@/lib/invitation-security", () => ({
  consumeRateLimit: (...args: unknown[]) => consumeRateLimitMock(...args),
}));

vi.mock("@/lib/request-metadata", () => ({
  getRequestId: vi.fn(() => "req-test"),
  logRequestMeta: vi.fn(),
}));

const VALID_TOKEN = "a".repeat(64);

function makeParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

function makeGetRequest(token: string) {
  return new Request(`http://localhost/api/capture/${token}`) as any;
}

function makePostRequest(token: string, file?: File) {
  const formData = new FormData();
  if (file) formData.append("photo", file);
  return new Request(`http://localhost/api/capture/${token}`, {
    method: "POST",
    body: formData,
  }) as any;
}

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    photo_mime: null,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe("/api/capture/[token]", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    consumeRateLimitMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  });

  it("GET rejects malformed tokens without touching the DB", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeGetRequest("nope"), makeParams("nope"));
    expect(response.status).toBe(404);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("GET reports a valid pending session", async () => {
    queryMock.mockResolvedValueOnce({ rows: [sessionRow()] });
    const { GET } = await import("./route");
    const response = await GET(makeGetRequest(VALID_TOKEN), makeParams(VALID_TOKEN));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.valid).toBe(true);
    // Only the hash may be used for lookup.
    expect(queryMock.mock.calls[0][1]).toEqual([hashPhoneCaptureToken(VALID_TOKEN)]);
  });

  it("GET reports an expired session as invalid", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [sessionRow({ expires_at: new Date(Date.now() - 1000).toISOString() })],
    });
    const { GET } = await import("./route");
    const response = await GET(makeGetRequest(VALID_TOKEN), makeParams(VALID_TOKEN));
    const data = await response.json();
    expect(data.valid).toBe(false);
    expect(data.reason).toBe("expired");
  });

  it("POST returns 404 for an unknown token", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const { POST } = await import("./route");
    const file = new File([new Uint8Array(10)], "photo.jpg", { type: "image/jpeg" });
    const response = await POST(makePostRequest(VALID_TOKEN, file), makeParams(VALID_TOKEN));
    expect(response.status).toBe(404);
  });

  it("POST returns 429 when rate limited", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const { POST } = await import("./route");
    const file = new File([new Uint8Array(10)], "photo.jpg", { type: "image/jpeg" });
    const response = await POST(makePostRequest(VALID_TOKEN, file), makeParams(VALID_TOKEN));
    expect(response.status).toBe(429);
  });

  it("POST rejects non-image uploads", async () => {
    queryMock.mockResolvedValueOnce({ rows: [sessionRow()] });
    const { POST } = await import("./route");
    const file = new File([new Uint8Array(10)], "doc.pdf", { type: "application/pdf" });
    const response = await POST(makePostRequest(VALID_TOKEN, file), makeParams(VALID_TOKEN));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Unsupported image type");
  });

  it("POST stores a valid photo against the session", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [sessionRow()] }) // loadSession
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    const { POST } = await import("./route");
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
    const response = await POST(makePostRequest(VALID_TOKEN, file), makeParams(VALID_TOKEN));
    expect(response.status).toBe(200);
    const updateCall = queryMock.mock.calls[1];
    expect(updateCall[0]).toContain("UPDATE phone_capture_sessions");
    expect(updateCall[1][1]).toBe("image/jpeg");
    expect(updateCall[1][2]).toBe("session-1");
  });
});
