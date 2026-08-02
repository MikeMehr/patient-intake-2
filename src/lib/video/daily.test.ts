import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDailyRoom,
  deleteDailyRoom,
  isDailyConfigured,
  mintDailyMeetingToken,
  toUnixSeconds,
} from "./daily";

const API_KEY = "test-daily-key-abc123";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function lastBody(fn: ReturnType<typeof vi.fn>) {
  return JSON.parse(fn.mock.calls[0][1].body);
}

beforeEach(() => {
  process.env.DAILY_API_KEY = API_KEY;
  process.env.DAILY_DOMAIN = "clinic.daily.co";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DAILY_API_KEY;
  delete process.env.DAILY_DOMAIN;
});

describe("toUnixSeconds", () => {
  it("returns seconds, not milliseconds", () => {
    // Daily silently accepts a millisecond value and treats it as a date ~50,000 years out, so
    // the room never expires. Nothing surfaces this at runtime — only this assertion does.
    const d = new Date("2026-08-05T17:00:00.000Z");
    expect(toUnixSeconds(d)).toBe(1785949200);
    expect(toUnixSeconds(d)).toBeLessThan(d.getTime());
  });
});

describe("isDailyConfigured", () => {
  it("needs both the key and the domain", () => {
    expect(isDailyConfigured()).toBe(true);
    delete process.env.DAILY_DOMAIN;
    expect(isDailyConfigured()).toBe(false);
  });
});

describe("createDailyRoom", () => {
  it("posts a private, non-recording room with a seconds-based exp", async () => {
    const fetchMock = mockFetch(200, { name: "visit-abc", url: "https://clinic.daily.co/visit-abc" });
    const expiresAt = new Date("2026-08-05T18:00:00.000Z");

    const res = await createDailyRoom({ expiresAt });

    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.daily.co/v1/rooms");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);

    const body = lastBody(fetchMock);
    expect(body.privacy).toBe("private");
    expect(body.properties.enable_recording).toBe(false);
    expect(body.properties.enable_knocking).toBe(false);
    expect(body.properties.eject_at_room_exp).toBe(false);
    expect(body.properties.exp).toBe(toUnixSeconds(expiresAt));
  });

  it("names rooms randomly, never from a caller-supplied identifier", async () => {
    mockFetch(200, { url: "https://clinic.daily.co/x" });
    const a = await createDailyRoom({ expiresAt: new Date() });
    mockFetch(200, { url: "https://clinic.daily.co/y" });
    const b = await createDailyRoom({ expiresAt: new Date() });
    expect(a.ok && b.ok).toBe(true);
  });

  it("fails rather than throwing when Daily rejects the request", async () => {
    mockFetch(401, { error: "unauthorized" });
    const res = await createDailyRoom({ expiresAt: new Date() });
    expect(res).toMatchObject({ ok: false, status: 401 });
  });

  it("fails when Daily returns a room with no url", async () => {
    mockFetch(200, { name: "visit-abc" });
    const res = await createDailyRoom({ expiresAt: new Date() });
    expect(res.ok).toBe(false);
  });

  it("never leaks the API key into the error detail", async () => {
    // Daily echoes request context in some errors; `detail` reaches console.error and from
    // there the Azure log stream.
    mockFetch(400, `bad request with key ${API_KEY} attached`);
    const res = await createDailyRoom({ expiresAt: new Date() });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.detail).not.toContain(API_KEY);
      expect(res.detail).toContain("[redacted]");
    }
  });

  it("reports a clear failure when the key is missing entirely", async () => {
    delete process.env.DAILY_API_KEY;
    mockFetch(200, {});
    const res = await createDailyRoom({ expiresAt: new Date() });
    expect(res).toMatchObject({ ok: false, status: 503 });
  });
});

describe("mintDailyMeetingToken", () => {
  it("marks the provider as owner and the patient as not", async () => {
    const fetchMock = mockFetch(200, { token: "jwt-1" });
    await mintDailyMeetingToken({
      roomName: "visit-abc",
      userName: "Dr. Who",
      isOwner: true,
      expiresAt: new Date("2026-08-05T18:00:00.000Z"),
    });
    expect(lastBody(fetchMock).properties.is_owner).toBe(true);

    const patientMock = mockFetch(200, { token: "jwt-2" });
    await mintDailyMeetingToken({
      roomName: "visit-abc",
      userName: "Patient",
      isOwner: false,
      expiresAt: new Date("2026-08-05T18:00:00.000Z"),
    });
    expect(lastBody(patientMock).properties.is_owner).toBe(false);
  });

  it("sends exp and nbf in seconds", async () => {
    const fetchMock = mockFetch(200, { token: "jwt" });
    const exp = new Date("2026-08-05T18:00:00.000Z");
    const nbf = new Date("2026-08-05T16:45:00.000Z");
    await mintDailyMeetingToken({
      roomName: "r",
      userName: "u",
      isOwner: false,
      expiresAt: exp,
      notBefore: nbf,
    });
    const props = lastBody(fetchMock).properties;
    expect(props.exp).toBe(toUnixSeconds(exp));
    expect(props.nbf).toBe(toUnixSeconds(nbf));
  });

  it("fails when Daily returns no token", async () => {
    mockFetch(200, {});
    const res = await mintDailyMeetingToken({
      roomName: "r",
      userName: "u",
      isOwner: false,
      expiresAt: new Date(),
    });
    expect(res.ok).toBe(false);
  });
});

describe("deleteDailyRoom", () => {
  it("issues a DELETE against the named room", async () => {
    const fetchMock = mockFetch(200, {});
    await deleteDailyRoom("visit-abc");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.daily.co/v1/rooms/visit-abc");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});
