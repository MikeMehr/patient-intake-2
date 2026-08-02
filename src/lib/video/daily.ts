/**
 * Daily.co REST adapter — rooms and meeting tokens for video visits.
 *
 * Only this module talks to Daily's API. Everything above it deals in our own `video_visits`
 * rows, so swapping the backend later means reimplementing these four functions.
 *
 * Two conventions differ from the OSCAR client next door, on purpose:
 *
 *   - Plain `fetch`, not the SSL-tolerant `oscarFetch`. Daily is a public host with a real
 *     certificate; the self-signed tolerance that OSCAR needs would be a downgrade here. The
 *     host is a fixed constant, so there is no SSRF surface and no need for
 *     assertSafeOutboundUrl.
 *   - Failures are *not* best-effort. An OSCAR sync that fails leaves an appointment someone
 *     can enter by hand, so it is worth swallowing. A room that fails to create leaves a
 *     provider looking at a video page that will never connect, which is worse than an error.
 *     Only deleteDailyRoom is best-effort — rooms carry their own `exp` and expire regardless.
 */

import { randomBytes } from "crypto";

const DAILY_API_URL = process.env.DAILY_API_URL || "https://api.daily.co/v1";
const REQUEST_TIMEOUT_MS = 10_000;

export type DailyRoom = {
  name: string;
  url: string;
  expiresAt: Date;
};

export type DailyResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; detail: string };

export function isDailyConfigured(): boolean {
  return Boolean(process.env.DAILY_API_KEY && process.env.DAILY_DOMAIN);
}

/**
 * The Daily subdomain, e.g. "healthassist.daily.co". Also read by the proxy to build the
 * Permissions-Policy allowlist, which cannot use a wildcard and so needs the literal host.
 */
export function getDailyDomain(): string | null {
  return process.env.DAILY_DOMAIN?.trim() || null;
}

/**
 * Daily expresses `exp` and `nbf` in **seconds** since the epoch. Passing Date.now() directly
 * yields a timestamp roughly 50,000 years out, which Daily accepts silently — the room simply
 * never expires. Funnelling every conversion through one function keeps that mistake in one
 * testable place.
 */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export async function createDailyRoom(args: {
  expiresAt: Date;
}): Promise<DailyResult<DailyRoom>> {
  // Random, never derived from the appointment or demographic number. The room name is visible
  // in the iframe URL and in Daily's dashboard, so a derived name would both leak a clinic
  // identifier and make rooms enumerable if the token policy ever slipped.
  const name = `visit-${randomBytes(9).toString("hex")}`;

  const res = await dailyRequest("/rooms", {
    name,
    privacy: "private",
    properties: {
      exp: toUnixSeconds(args.expiresAt),
      // The room outliving the consult is harmless; being ejected mid-sentence because a visit
      // ran long is not. The meeting token's shorter exp is what actually bounds access.
      eject_at_room_exp: false,
      enable_prejoin_ui: true,
      // Entry is gated by meeting tokens. Knocking would instead put an admissions decision in
      // front of the provider in the middle of a consultation.
      enable_knocking: false,
      enable_chat: false,
      enable_screenshare: true,
      // Unconditional. Recording a consultation would put PHI into a third-party store and
      // pull a whole retention and consent problem into a feature that doesn't need it.
      enable_recording: false,
      start_video_off: false,
      start_audio_off: false,
    },
  });

  if (!res.ok) return res;

  const body = res.value as { name?: string; url?: string };
  const url = typeof body.url === "string" ? body.url : "";
  if (!url) {
    return { ok: false, status: 502, detail: "Daily returned a room with no url" };
  }
  return {
    ok: true,
    value: { name: body.name || name, url, expiresAt: args.expiresAt },
  };
}

export async function mintDailyMeetingToken(args: {
  roomName: string;
  userName: string;
  isOwner: boolean;
  expiresAt: Date;
  notBefore?: Date;
}): Promise<DailyResult<string>> {
  const res = await dailyRequest("/meeting-tokens", {
    properties: {
      room_name: args.roomName,
      user_name: args.userName,
      is_owner: args.isOwner,
      exp: toUnixSeconds(args.expiresAt),
      ...(args.notBefore ? { nbf: toUnixSeconds(args.notBefore) } : {}),
      eject_at_token_exp: true,
      enable_recording: false,
    },
  });

  if (!res.ok) return res;

  const token = (res.value as { token?: string }).token;
  if (typeof token !== "string" || !token) {
    return { ok: false, status: 502, detail: "Daily returned no meeting token" };
  }
  return { ok: true, value: token };
}

/**
 * Best-effort — the only call here that is. Rooms expire on their own `exp`, so a failed delete
 * costs nothing but a little clutter in the Daily dashboard, and it is called from cancellation
 * paths that must not fail because a third party is down.
 */
export async function deleteDailyRoom(name: string): Promise<DailyResult<void>> {
  const res = await dailyRequest(`/rooms/${encodeURIComponent(name)}`, null, "DELETE");
  return res.ok ? { ok: true, value: undefined } : res;
}

/**
 * Shared transport. Note what does *not* come back: `detail` is for our logs, and callers must
 * never pass it through to a client response — Daily echoes request context in some errors, and
 * this is the layer holding the API key.
 */
async function dailyRequest(
  path: string,
  body: unknown | null,
  method: "POST" | "DELETE" = "POST",
): Promise<DailyResult<unknown>> {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 503, detail: "DAILY_API_KEY is not configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${DAILY_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, detail: redactKey(text.slice(0, 500), apiKey) };
    }
    try {
      return { ok: true, value: text ? JSON.parse(text) : {} };
    } catch {
      return { ok: false, status: 502, detail: "Daily returned a non-JSON body" };
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: 503,
      detail: aborted ? "Daily request timed out" : "Network error reaching Daily",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Belt and braces: the API key should never appear in a response body, but `detail` reaches
 * console.error and from there the Azure log stream, which is a wider audience than the key
 * deserves.
 */
function redactKey(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join("[redacted]") : text;
}
