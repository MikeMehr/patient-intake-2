import { beforeEach, describe, expect, it, vi } from "vitest";

const validateRequestMock = vi.hoisted(() => vi.fn());
const getClinicBySlugMock = vi.hoisted(() => vi.fn());
const consumeDbRateLimitMock = vi.hoisted(() => vi.fn());
const sendBookingLinkSMSMock = vi.hoisted(() => vi.fn());
const sendMissedCallSMSMock = vi.hoisted(() => vi.fn());

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
  sendMissedCallSMS: (...args: unknown[]) => sendMissedCallSMSMock(...args),
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
    process.env.NEXT_PUBLIC_APP_URL = "https://mymd.health-assist.org";
    // Missed-call mode: the published number IS the handset, so we never dial back.
    delete process.env.CLINIC_FORWARD_TO_NUMBER;
    delete process.env.CALL_DEFLECT_NOTIFY_NUMBER;
    delete process.env.CALL_DEFLECT_SPOKEN_CLINIC_NAME;
    delete process.env.HIPAA_MODE;

    validateRequestMock.mockReturnValue(true);
    getClinicBySlugMock.mockResolvedValue({
      name: "MyMD Telehealth",
      slug: "mymd",
      phone: "604-880-7919",
      settings: { onlineBookingEnabled: true },
    });
    consumeDbRateLimitMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    sendBookingLinkSMSMock.mockResolvedValue({ success: true, messageSid: "SM1" });
    sendMissedCallSMSMock.mockResolvedValue({ success: true, messageSid: "SM2" });
  });

  it("texts the caller the booking link and tells the clinic they missed a call", async () => {
    const res = await callWebhook();
    const xml = await res.text();

    expect(res.status).toBe(200);
    expect(sendBookingLinkSMSMock).toHaveBeenCalledWith("+16045551234", {
      clinicName: "MyMD Telehealth",
      bookingUrl: "https://mymd.health-assist.org/booking/mymd",
    });
    expect(sendMissedCallSMSMock).toHaveBeenCalledWith("604-880-7919", {
      callerNumber: "+16045551234",
      outcome: "link-sent",
    });
    expect(xml).toContain("texted you a link");
    expect(xml).toContain("<Hangup/>");
    // Must never dial back: the published number is the handset that forwarded here.
    expect(xml).not.toContain("<Dial");
  });

  it("tells callers to dial 911 in an emergency, since they reached a recording", async () => {
    const res = await callWebhook();
    const xml = await res.text();

    expect(xml).toContain("9 1 1");
  });

  it("speaks the clinic name as it should sound, not as it is spelled", async () => {
    process.env.CALL_DEFLECT_SPOKEN_CLINIC_NAME = "My MD Telehealth";

    const res = await callWebhook();
    const xml = await res.text();

    expect(xml).toContain("My MD Telehealth");
    expect(xml).not.toContain("MyMD");
    // The text message keeps the real brand spelling.
    expect(sendBookingLinkSMSMock).toHaveBeenCalledWith(
      "+16045551234",
      expect.objectContaining({ clinicName: "MyMD Telehealth" }),
    );
  });

  it("falls back to the name on record when no spoken name is configured", async () => {
    const res = await callWebhook();
    const xml = await res.text();

    expect(xml).toContain("MyMD Telehealth");
  });

  it("speaks with a neural voice, not Twilio's robotic legacy one", async () => {
    const res = await callWebhook();
    const xml = await res.text();

    expect(xml).toContain('voice="Polly.Joanna-Neural"');
    expect(xml).not.toContain('voice="alice"');
  });

  it("keeps the spoken message short — the detail belongs in the text", async () => {
    const res = await callWebhook();
    const xml = await res.text();

    const spoken = [...xml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)]
      .map((m) => m[1])
      .join(" ");
    // ~15 words/10s of synthetic speech; the old script ran to ~50.
    expect(spoken.split(/\s+/).length).toBeLessThan(35);
  });

  it("rejects a request with an invalid Twilio signature and sends no SMS", async () => {
    validateRequestMock.mockReturnValue(false);

    const res = await callWebhook();

    expect(res.status).toBe(403);
    expect(sendBookingLinkSMSMock).not.toHaveBeenCalled();
    expect(sendMissedCallSMSMock).not.toHaveBeenCalled();
  });

  it("points callers who got no link at email, and never promises a call back", async () => {
    // A landline caller: no text can reach them, so the voice is all they get.
    sendBookingLinkSMSMock.mockResolvedValue({ success: false, error: "landline" });

    const res = await callWebhook();
    const xml = await res.text();

    expect(xml).toContain("info at my M D online dot C A");
    expect(xml).not.toMatch(/call you back/i);
  });

  it("still notifies the clinic when a repeat caller is not re-texted", async () => {
    consumeDbRateLimitMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });

    const res = await callWebhook();
    const xml = await res.text();

    expect(sendBookingLinkSMSMock).not.toHaveBeenCalled();
    // The dedupe covers the caller's text only — every missed call must surface.
    // "already-texted", NOT a landline: the clinic must not be told to call back.
    expect(sendMissedCallSMSMock).toHaveBeenCalledWith("604-880-7919", {
      callerNumber: "+16045551234",
      outcome: "already-texted",
    });
    // Points them at the link they already have, without claiming a fresh send.
    expect(xml).toContain("already texted you a link");
    expect(xml).not.toContain("just texted you a link");
  });

  it("notifies the clinic of a withheld-caller-ID call without texting", async () => {
    const res = await callWebhook({ From: "anonymous" });
    const xml = await res.text();

    expect(sendBookingLinkSMSMock).not.toHaveBeenCalled();
    expect(sendMissedCallSMSMock).toHaveBeenCalledWith("604-880-7919", {
      callerNumber: "anonymous",
      outcome: "needs-callback",
    });
    expect(xml).toContain("<Hangup/>");
  });

  it("tells the clinic to call back when the caller's text fails", async () => {
    sendBookingLinkSMSMock.mockResolvedValue({ success: false, error: "landline" });

    const res = await callWebhook();

    expect(res.status).toBe(200);
    expect(sendMissedCallSMSMock).toHaveBeenCalledWith("604-880-7919", {
      callerNumber: "+16045551234",
      outcome: "needs-callback",
    });
  });

  it("prefers CALL_DEFLECT_NOTIFY_NUMBER over the clinic's own number", async () => {
    process.env.CALL_DEFLECT_NOTIFY_NUMBER = "+16049990000";

    await callWebhook();

    expect(sendMissedCallSMSMock).toHaveBeenCalledWith(
      "+16049990000",
      expect.objectContaining({ callerNumber: "+16045551234" }),
    );
  });

  it("still answers the call when the clinic lookup throws", async () => {
    getClinicBySlugMock.mockRejectedValue(new Error("db down"));

    const res = await callWebhook();
    const xml = await res.text();

    expect(res.status).toBe(200);
    expect(xml).toContain("<Hangup/>");
  });

  it("still answers the call when the missed-call notification throws", async () => {
    sendMissedCallSMSMock.mockRejectedValue(new Error("twilio down"));

    const res = await callWebhook();
    const xml = await res.text();

    expect(res.status).toBe(200);
    expect(xml).toContain("<Hangup/>");
  });

  it("sends no SMS at all when the feature is unconfigured", async () => {
    delete process.env.CALL_DEFLECT_CLINIC_SLUG;

    const res = await callWebhook();

    expect(res.status).toBe(200);
    expect(sendBookingLinkSMSMock).not.toHaveBeenCalled();
    expect(sendMissedCallSMSMock).not.toHaveBeenCalled();
  });

  it("escapes XML metacharacters in the clinic name", async () => {
    getClinicBySlugMock.mockResolvedValue({
      name: 'MyMD "Health" & Wellness',
      slug: "mymd",
      phone: "604-880-7919",
      settings: { onlineBookingEnabled: true },
    });

    const res = await callWebhook();
    const xml = await res.text();

    expect(xml).not.toContain('"Health" & Wellness');
    expect(xml).toContain("&amp;");
  });

  describe("when CLINIC_FORWARD_TO_NUMBER is set (published number differs from handset)", () => {
    beforeEach(() => {
      process.env.CLINIC_FORWARD_TO_NUMBER = "+16045550000";
    });

    it("connects the call and skips the missed-call notification", async () => {
      const res = await callWebhook();
      const xml = await res.text();

      expect(xml).toContain("<Dial");
      expect(xml).toContain("+16045550000");
      expect(xml).toContain("Stay on the line");
      expect(sendMissedCallSMSMock).not.toHaveBeenCalled();
    });
  });
});
