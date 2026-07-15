import { beforeEach, describe, expect, it, vi } from "vitest";

const validateRequestMock = vi.hoisted(() => vi.fn());
const getClinicBySlugMock = vi.hoisted(() => vi.fn());
const consumeDbRateLimitMock = vi.hoisted(() => vi.fn());
const sendBookingLinkSMSMock = vi.hoisted(() => vi.fn());

vi.mock("twilio", () => ({
  validateRequest: (...args: unknown[]) => validateRequestMock(...args),
}));

vi.mock("@/lib/booking-store", () => ({
  getClinicBySlug: (...args: unknown[]) => getClinicBySlugMock(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeDbRateLimit: (...args: unknown[]) => consumeDbRateLimitMock(...args),
}));

vi.mock("@/lib/sms", () => ({
  sendBookingLinkSMS: (...args: unknown[]) => sendBookingLinkSMSMock(...args),
  toE164: (phone: string) => phone,
}));

vi.mock("@/lib/secure-logger", () => ({
  logDebug: vi.fn(),
}));

import { POST } from "./route";

function callWebhook(body: Record<string, string> = { From: "+16045551234" }) {
  return POST(
    new Request("https://mymd.health-assist.org/api/voice/incoming", {
      method: "POST",
      headers: {
        "x-twilio-signature": "sig",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    }) as unknown as Parameters<typeof POST>[0],
  );
}

describe("POST /api/voice/incoming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_PHONE_NUMBER = "+17785550000";
    process.env.CALL_DEFLECT_CLINIC_SLUG = "mymd";
    process.env.CLINIC_FORWARD_TO_NUMBER = "+16048807919";
    process.env.NEXT_PUBLIC_APP_URL = "https://mymd.health-assist.org";
    delete process.env.HIPAA_MODE;

    validateRequestMock.mockReturnValue(true);
    getClinicBySlugMock.mockResolvedValue({
      name: "MyMD Medical Clinic",
      slug: "mymd",
      settings: { onlineBookingEnabled: true },
    });
    consumeDbRateLimitMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    sendBookingLinkSMSMock.mockResolvedValue({ success: true, messageSid: "SM1" });
  });

  it("texts the booking link and connects the call", async () => {
    const res = await callWebhook();
    const xml = await res.text();

    expect(res.status).toBe(200);
    expect(sendBookingLinkSMSMock).toHaveBeenCalledWith("+16045551234", {
      clinicName: "MyMD Medical Clinic",
      bookingUrl: "https://mymd.health-assist.org/booking/mymd",
    });
    expect(xml).toContain("texted you a link");
    expect(xml).toContain("<Dial");
    expect(xml).toContain("+16048807919");
  });

  it("rejects a request with an invalid Twilio signature and sends no SMS", async () => {
    validateRequestMock.mockReturnValue(false);

    const res = await callWebhook();

    expect(res.status).toBe(403);
    expect(sendBookingLinkSMSMock).not.toHaveBeenCalled();
  });

  it("does not text a caller who already got a link, but still connects them", async () => {
    consumeDbRateLimitMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });

    const res = await callWebhook();
    const xml = await res.text();

    expect(sendBookingLinkSMSMock).not.toHaveBeenCalled();
    expect(xml).toContain("<Dial");
    expect(xml).not.toContain("texted you a link");
  });

  it("connects the call without SMS when caller ID is withheld", async () => {
    const res = await callWebhook({ From: "anonymous" });
    const xml = await res.text();

    expect(sendBookingLinkSMSMock).not.toHaveBeenCalled();
    expect(xml).toContain("<Dial");
  });

  it("still connects the call when the SMS fails", async () => {
    sendBookingLinkSMSMock.mockResolvedValue({ success: false, error: "unreachable carrier" });

    const res = await callWebhook();
    const xml = await res.text();

    expect(res.status).toBe(200);
    expect(xml).toContain("<Dial");
  });

  it("still connects the call when the clinic lookup throws", async () => {
    getClinicBySlugMock.mockRejectedValue(new Error("db down"));

    const res = await callWebhook();
    const xml = await res.text();

    expect(res.status).toBe(200);
    expect(xml).toContain("<Dial");
  });

  it("hangs up gracefully when no forwarding number is configured", async () => {
    delete process.env.CLINIC_FORWARD_TO_NUMBER;

    const res = await callWebhook();
    const xml = await res.text();

    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
  });

  it("escapes XML metacharacters in the clinic name", async () => {
    getClinicBySlugMock.mockResolvedValue({
      name: 'MyMD "Health" & Wellness',
      slug: "mymd",
      settings: { onlineBookingEnabled: true },
    });

    const res = await callWebhook();
    const xml = await res.text();

    expect(xml).toContain("&amp;");
    expect(xml).toContain("&quot;");
  });
});
