import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getClinicBySlugMock = vi.hoisted(() => vi.fn());
const consumeDbRateLimitMock = vi.hoisted(() => vi.fn());
const sendBookingIssueSMSMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/booking-store", () => ({
  getClinicBySlug: (...args: unknown[]) => getClinicBySlugMock(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeDbRateLimit: (...args: unknown[]) => consumeDbRateLimitMock(...args),
}));

vi.mock("@/lib/sms", () => ({
  sendBookingIssueSMS: (...args: unknown[]) => sendBookingIssueSMSMock(...args),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const ORG = "11111111-1111-1111-1111-111111111111";
const params = Promise.resolve({ clinicSlug: "mymd" });

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest("https://booking.test/api/booking/mymd/report-issue", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  getClinicBySlugMock.mockReset().mockResolvedValue({ id: ORG, name: "MyMD Telehealth" });
  consumeDbRateLimitMock.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  sendBookingIssueSMSMock.mockReset().mockResolvedValue({ success: true, messageSid: "SM1" });
  process.env.BOOKING_ISSUE_ALERT_PHONE = "604-727-7953";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.BOOKING_ISSUE_ALERT_PHONE;
  vi.restoreAllMocks();
});

describe("POST /api/booking/[clinicSlug]/report-issue", () => {
  it("texts the alert number with the reported page state", async () => {
    const res = await POST(makeRequest({ state: "no-times" }), { params });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendBookingIssueSMSMock).toHaveBeenCalledWith(
      "604-727-7953",
      expect.objectContaining({ clinicName: "MyMD Telehealth", state: "no-times" }),
    );
  });

  it("sends with no body at all — a bare click is a valid report", async () => {
    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(sendBookingIssueSMSMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ state: "other" }),
    );
  });

  it("never puts caller-supplied text into the message", async () => {
    await POST(makeRequest({ state: "Call 1-900-SCAM now" }), { params });

    expect(sendBookingIssueSMSMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ state: "other" }),
    );
  });

  it("404s for an unknown clinic", async () => {
    getClinicBySlugMock.mockResolvedValue(null);

    const res = await POST(makeRequest({ state: "other" }), { params });

    expect(res.status).toBe(404);
    expect(sendBookingIssueSMSMock).not.toHaveBeenCalled();
  });

  it("still reassures the patient when the same person clicks again", async () => {
    consumeDbRateLimitMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });

    const res = await POST(makeRequest({ state: "page-error" }), { params });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendBookingIssueSMSMock).not.toHaveBeenCalled();
  });

  it("caps the texts per clinic during an outage, not just per reporter", async () => {
    consumeDbRateLimitMock
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 }) // this IP is fine
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 1800 }); // clinic already alerted

    const res = await POST(makeRequest({ state: "no-times" }), { params });

    expect(res.status).toBe(200);
    expect(sendBookingIssueSMSMock).not.toHaveBeenCalled();
  });

  it("does not fail the patient when the alert number is unconfigured", async () => {
    delete process.env.BOOKING_ISSUE_ALERT_PHONE;

    const res = await POST(makeRequest({ state: "other" }), { params });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendBookingIssueSMSMock).not.toHaveBeenCalled();
  });

  it("does not fail the patient when Twilio rejects the send", async () => {
    sendBookingIssueSMSMock.mockResolvedValue({ success: false, error: "twilio down" });

    const res = await POST(makeRequest({ state: "slot-failed" }), { params });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
